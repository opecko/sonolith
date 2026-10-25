# Helpers for docs/dev/api-manual-test.md. Source them in fish: `source docs/dev/api-manual-test.fish`.
# They talk to the running Sonolith over its socket with socat and print results with jq.
# The token of the test app lives in ~/.config/sonolith-manual/token (mode 600).

set -g SNL_APP com.example.manualtest
set -g SNL_SOCK $XDG_RUNTIME_DIR/sonolith/api.sock
set -g SNL_TOKEN_FILE ~/.config/sonolith-manual/token

function snl-hello --description 'the session.hello line (id 1) for the stored token'
    printf '{"jsonrpc":"2.0","id":1,"method":"session.hello","params":{"appId":"%s","token":"%s","apiVersion":"1.0"}}\n' $SNL_APP (cat $SNL_TOKEN_FILE)
end

# snl-register [optional scopes...]   player:read is required; the others can be unticked on the consent screen.
# Default optional scopes: all of them.
function snl-register
    set -l optional $argv
    test (count $optional) -eq 0; and set optional player:control queue:read queue:write library:read library:write search lyrics:read
    mkdir -p (dirname $SNL_TOKEN_FILE); chmod 700 (dirname $SNL_TOKEN_FILE)
    echo "Waiting for you to answer in Sonolith (up to 5 minutes)..."
    jq -nc '{jsonrpc:"2.0",id:1,method:"app.register",params:{appId:$app,name:"Manual test",description:"Checks Sonolith by hand from a terminal.",publisher:"Me",scopes:([{scope:"player:read",required:true,reason:"To see what is playing"}] + [$ARGS.positional[] | {scope:., required:false, reason:("To test " + .)}]),apiVersion:"1.0"}}' --arg app $SNL_APP --args $optional \
        | socat -t 310 - UNIX-CONNECT:$SNL_SOCK | tee /dev/stderr \
        | jq -r 'select(.method=="registration.resolved") | .params | if .status=="approved" then .token else empty end' > $SNL_TOKEN_FILE.new
    if test -s $SNL_TOKEN_FILE.new
        mv $SNL_TOKEN_FILE.new $SNL_TOKEN_FILE; chmod 600 $SNL_TOKEN_FILE
        echo "Approved: token stored."
    else
        rm -f $SNL_TOKEN_FILE.new
        echo "Not approved (see the status above)."
    end
end

# snl METHOD [PARAMS_JSON]   one call on a fresh session; prints the result or the error (and the hello error first,
# marked `hello: failed`, when the session could not start: Blocked, Unauthorized, NotRegistered).
function snl
    set -l params '{}'
    test (count $argv) -ge 2; and set params $argv[2]
    begin
        snl-hello
        jq -nc --arg m $argv[1] --argjson p $params '{jsonrpc:"2.0",id:2,method:$m,params:$p}'
    end | socat -t 40 - UNIX-CONNECT:$SNL_SOCK | jq 'select(.id==2 or (.id==1 and .error)) | (if .id==1 then {hello: "failed"} else {} end) + (if .error then {error: .error.data.name, reason: .error.data.reason, data: .error.data} else {result} end)'
end

# snl-follow TOPIC...   subscribes and prints events until Ctrl+C. Topics: player.state player.track player.position
# player.volume queue lyrics lyrics.line lyrics.word account. Also shows session.scopesChanged and session.revoked.
function snl-follow
    begin
        snl-hello
        jq -nc --args '{jsonrpc:"2.0",id:2,method:"events.subscribe",params:{topics:$ARGS.positional}}' $argv
        sleep 86400
    end | socat - UNIX-CONNECT:$SNL_SOCK | jq --unbuffered -c 'if .id then {id, result, error: .error.data} else {event: .method, params} end'
end

function snl-unregister
    begin
        snl-hello
        echo '{"jsonrpc":"2.0","id":2,"method":"app.unregister"}'
    end | socat -t 5 - UNIX-CONNECT:$SNL_SOCK | jq -c 'select(.id==2)'
    rm -f $SNL_TOKEN_FILE
end
