# Sonolith API from PowerShell (Windows PowerShell 5.1 and PowerShell 7 on Windows).
#
#   . .\sonolith.ps1
#   Register-Sonolith        # once: click Allow in Sonolith
#   Get-SonolithState
#   Disconnect-Sonolith
#
# The token is stored encrypted for the current Windows account (DPAPI) in %APPDATA%\sonolith-shell\token.

$SonolithAppId = 'com.example.sonolith-powershell'
$SonolithTokenFile = Join-Path $env:APPDATA 'sonolith-shell\token'

Add-Type -Namespace SonolithApi -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint serverProcessId);
'@

function Open-SonolithPipe {
    $file = Join-Path $env:LOCALAPPDATA 'Sonolith\api\discovery.json'
    if (-not (Test-Path $file)) { throw "Sonolith is not running, or 'Let other apps connect to Sonolith' is off in its Settings > Connected apps." }
    $info = Get-Content $file -Raw | ConvertFrom-Json
    $name = $info.path -replace '^\\\\\.\\pipe\\', ''
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', $name, [System.IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(3000)
    # Make sure the pipe belongs to the Sonolith in discovery.json before sending a token.
    $serverPid = [uint32]0
    if ([SonolithApi.Native]::GetNamedPipeServerProcessId($pipe.SafePipeHandle.DangerousGetHandle(), [ref]$serverPid) -and $serverPid -ne $info.pid) {
        $pipe.Dispose()
        throw "The pipe belongs to process $serverPid, not to Sonolith ($($info.pid))."
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $writer = New-Object System.IO.StreamWriter($pipe, $utf8)
    $writer.AutoFlush = $true
    $writer.NewLine = "`n"
    [pscustomobject]@{ Pipe = $pipe; Reader = (New-Object System.IO.StreamReader($pipe, $utf8)); Writer = $writer; NextId = 1 }
}

function Send-SonolithRequest($conn, [string]$method, $params) {
    $id = $conn.NextId; $conn.NextId++
    $msg = @{ jsonrpc = '2.0'; id = $id; method = $method }
    if ($null -ne $params) { $msg.params = $params }
    $conn.Writer.WriteLine(($msg | ConvertTo-Json -Compress -Depth 10))
    $id
}

# Reads lines until the response with this id; notifications in between are skipped.
function Read-SonolithResponse($conn, $id) {
    while ($true) {
        $line = $conn.Reader.ReadLine()
        if ($null -eq $line) { throw 'Sonolith closed the connection.' }
        if (-not $line.Trim()) { continue }
        $msg = $line | ConvertFrom-Json
        if ($msg.id -eq $id) { return $msg }
    }
}

function Get-SonolithToken {
    if (-not (Test-Path $SonolithTokenFile)) { throw 'Not connected to Sonolith. Run Register-Sonolith.' }
    $secure = Get-Content $SonolithTokenFile | ConvertTo-SecureString
    (New-Object System.Net.NetworkCredential('', $secure)).Password
}

# Sends session.hello and then each request (@{ method = '…'; params = @{…} }); returns all responses, hello first.
function Invoke-Sonolith([object[]]$Requests) {
    $conn = Open-SonolithPipe
    try {
        $token = Get-SonolithToken
        $hello = Read-SonolithResponse $conn (Send-SonolithRequest $conn 'session.hello' @{ appId = $SonolithAppId; token = $token; apiVersion = '1.0' })
        if ($hello.error) {
            if ($hello.error.data.name -in 'Unauthorized', 'NotRegistered', 'Blocked') { Remove-Item $SonolithTokenFile -ErrorAction SilentlyContinue }
            throw "Disconnected from Sonolith ($($hello.error.data.name))."
        }
        $out = @($hello)
        foreach ($r in $Requests) { $out += Read-SonolithResponse $conn (Send-SonolithRequest $conn $r.method $r.params) }
        $out
    } finally { $conn.Pipe.Dispose() }
}

function Register-Sonolith {
    $conn = Open-SonolithPipe
    try {
        $params = @{
            appId = $SonolithAppId; name = 'PowerShell'; publisher = 'Me'; apiVersion = '1.0'
            description = 'PowerShell commands that read what Sonolith is playing.'
            scopes = @(@{ scope = 'player:read'; required = $true; reason = 'To show the current song in PowerShell' })
        }
        $res = Read-SonolithResponse $conn (Send-SonolithRequest $conn 'app.register' $params)
        if ($res.error) { throw "Registration failed: $($res.error.data.name)" }
        Write-Host 'Approve the request in Sonolith...'
        while ($true) {
            $line = $conn.Reader.ReadLine()
            if ($null -eq $line) { throw 'Sonolith closed the connection; the request was cancelled.' }
            $msg = $line | ConvertFrom-Json
            if ($msg.method -ne 'registration.resolved' -or $msg.params.requestId -ne $res.result.requestId) { continue }
            if ($msg.params.status -ne 'approved') { throw "Not connected: $($msg.params.status)." }
            New-Item -ItemType Directory -Force (Split-Path $SonolithTokenFile) | Out-Null
            $msg.params.token | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $SonolithTokenFile
            Write-Host "Connected. Granted: $($msg.params.grantedScopes -join ', ')"
            return
        }
    } finally { $conn.Pipe.Dispose() }
}

function Get-SonolithState { (Invoke-Sonolith @(@{ method = 'player.getState' }))[-1].result }

function Disconnect-Sonolith {
    try { Invoke-Sonolith @(@{ method = 'app.unregister' }) | Out-Null }
    catch { Write-Warning "Could not reach Sonolith: $_" }
    finally { Remove-Item $SonolithTokenFile -ErrorAction SilentlyContinue }
    Write-Host 'Disconnected from Sonolith.'
}
