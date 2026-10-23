import { describe, expect, it } from "vitest";
import { baseTitle, isEditorialPlaylist, pickSong, searchTitle, songVersions } from "./songVersions";
import type { Track } from "./types";

const t = (id: string, title: string, artists: string[], extra: Partial<Track> = {}): Track => ({ type: "track", id, title, subtitle: artists.join(", "), artists, ...extra });

describe("songVersions", () => {
  it("only YouTube Music's own playlists", () => {
    expect(isEditorialPlaylist("RDCLAK5uy_lncN931oN6KUNOw36oAtvAGDRdrlj4LGY")).toBe(true);
    expect(isEditorialPlaylist("VLRDCLAK5uy_x")).toBe(true);
    expect(isEditorialPlaylist("PLeO514NesGCf21NlkSP4P_kH9QAz4tb56")).toBe(false);
  });

  it("cleans titles", () => {
    expect(searchTitle("Let It Happen (Official Video)")).toBe("Let It Happen");
    expect(searchTitle("Is It True [Lyric Video]")).toBe("Is It True");
    expect(searchTitle("Dracula (Live from Pier 4 at Brooklyn Army Terminal)")).toBe("Dracula (Live from Pier 4 at Brooklyn Army Terminal)");
    expect(baseTitle("Neverender (feat. Tame Impala)")).toBe("neverender");
  });

  it("picks the closest song with a shared artist", () => {
    const video = t("v", "Dracula (Live from Pier 4 at Brooklyn Army Terminal)", ["Tame Impala"], { video: true });
    const songs = [t("a", "Dracula (feat. JENNIE)", ["Tame Impala", "JENNIE"]), t("b", "Dracula", ["Tame Impala"]), t("c", "Dracula", ["Someone Else"])];
    expect(pickSong(video, songs)?.id).toBe("b");
    expect(pickSong(t("v2", "Let It Happen (Official Video)", ["Tame Impala"], { video: true }), [t("x", "Let It Happen", ["tame impala"])])?.id).toBe("x");
    expect(pickSong(video, [t("d", "Elephant", ["Tame Impala"])])).toBeUndefined();
  });

  it("swaps videos, keeps songs and misses, survives failed searches", async () => {
    const tracks = [t("v1", "Loser (Official Video)", ["Tame Impala"], { video: true }), t("s1", "Elephant", ["Tame Impala"]), t("v2", "Nothing (Official Video)", ["Tame Impala"], { video: true }), t("v3", "Boom (Official Video)", ["Tame Impala"], { video: true })];
    const search = async (q: string) => {
      if (q.startsWith("Boom")) throw new Error("offline");
      return q.startsWith("Loser") ? [t("song1", "Loser", ["Tame Impala"])] : [];
    };
    const out = await songVersions(tracks, search);
    expect(out.map((x) => x.id)).toEqual(["song1", "s1", "v2", "v3"]);
  });
});
