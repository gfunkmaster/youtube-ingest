import { describe, expect, it } from "vitest";

import {
  canonicalWatchUrl,
  InvalidVideoIdError,
  parseVideoId,
  playlistIdOf,
} from "../src/youtube/video-id.js";

const ID = "45K3zHckCnQ";

describe("parseVideoId", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, "watch URL"],
    [`https://www.youtube.com/watch?v=${ID}&t=120s`, "watch URL with extra params"],
    [`https://m.youtube.com/watch?v=${ID}`, "mobile watch URL"],
    [`https://music.youtube.com/watch?v=${ID}`, "music.youtube.com"],
    [`https://youtu.be/${ID}`, "youtu.be short link"],
    [`https://youtu.be/${ID}?si=abc`, "youtu.be with query"],
    [`https://www.youtube.com/shorts/${ID}`, "shorts"],
    [`https://www.youtube.com/live/${ID}`, "live"],
    [`https://www.youtube.com/embed/${ID}`, "embed"],
    [`https://www.youtube-nocookie.com/embed/${ID}`, "nocookie embed"],
    [ID, "bare id"],
    [`  ${ID}  `, "bare id with whitespace"],
    [`watch?v=${ID}&t=5s`, "scheme-less watch string"],
  ])("parses %s (%s)", (input) => {
    expect(parseVideoId(input)).toBe(ID);
  });

  it("throws InvalidVideoIdError for a non-YouTube string", () => {
    expect(() => parseVideoId("https://example.com/not-a-video")).toThrow(
      InvalidVideoIdError,
    );
  });

  it("throws for an id of the wrong length", () => {
    expect(() => parseVideoId("https://youtu.be/tooshort")).toThrow(InvalidVideoIdError);
  });
});

describe("canonicalWatchUrl", () => {
  it("builds a canonical watch URL", () => {
    expect(canonicalWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});

describe("playlistIdOf", () => {
  const LIST = "PLrAXtmRdnEQy6nuLMHjMZOz59Oq1M6MNA";

  it("finds the playlist id in a playlist URL", () => {
    expect(playlistIdOf(`https://www.youtube.com/playlist?list=${LIST}`)).toBe(LIST);
  });

  it("finds the playlist id when the URL also has a video", () => {
    expect(playlistIdOf(`https://www.youtube.com/watch?v=${ID}&list=${LIST}`)).toBe(LIST);
  });

  it("finds the playlist id in a scheme-less string", () => {
    expect(playlistIdOf(`watch?v=${ID}&list=${LIST}`)).toBe(LIST);
  });

  it("returns undefined for a plain video URL", () => {
    expect(playlistIdOf(`https://youtu.be/${ID}`)).toBeUndefined();
    expect(playlistIdOf(`https://www.youtube.com/watch?v=${ID}`)).toBeUndefined();
  });

  it("returns undefined for unparseable input", () => {
    expect(playlistIdOf("not a url")).toBeUndefined();
  });
});
