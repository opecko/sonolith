import { describe, expect, it } from "vitest";
import { normalizeChoice, parseAccountSwitcher, sameAccount } from "./accounts";

const runs = (text: string) => ({ runs: [{ text }] });
const item = (name: string, signinUrl: string, extra: object = {}) => ({
  accountItem: {
    accountName: runs(name),
    accountPhoto: { thumbnails: [{ url: `https://yt3.ggpht.com/${name}=s48-c-k-c0x00ffffff-no-rj`, width: 48, height: 48 }] },
    isSelected: false,
    isDisabled: false,
    hasChannel: true,
    serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ offlineCacheKeyToken: {} }, { accountSigninToken: { signinUrl } }] } },
    accountByline: runs("2 subscribers"),
    ...extra,
  },
});

// Shape of music.youtube.com/getAccountSwitcherEndpoint (2026-10), names and ids made up.
const response =
  ")]}'\n" +
  JSON.stringify({
    code: "SUCCESS",
    data: {
      actions: [
        {
          getMultiPageMenuAction: {
            menu: {
              multiPageMenuRenderer: {
                sections: [
                  {
                    accountSectionListRenderer: {
                      contents: [
                        {
                          accountItemSectionRenderer: {
                            contents: [
                              item("Main", "/signin?action_handle_signin=true&authuser=0&next=x", { isSelected: true, channelHandle: runs("@main") }),
                              item("Brand", "/signin?authuser=0&pageid=123456&next=x", { channelHandle: runs("@brand") }),
                              item("Gone", "/signin?authuser=0&pageid=9", { isDisabled: true }),
                              { unknownRenderer: {} },
                            ],
                          },
                        },
                      ],
                      header: { googleAccountHeaderRenderer: { name: runs("Person"), email: runs("person@example.com") } },
                    },
                  },
                  {
                    accountSectionListRenderer: {
                      contents: [
                        {
                          accountItemSectionRenderer: {
                            contents: [item("Second", "/signin?authuser=1&next=x")],
                            header: { accountItemSectionHeaderRenderer: { title: runs("second@example.com") } },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });

describe("parseAccountSwitcher", () => {
  it("lists channels per Google account with their session index and page id", () => {
    const groups = parseAccountSwitcher(response);
    expect(groups.map((g) => [g.title, g.subtitle])).toEqual([
      ["Person", "person@example.com"],
      ["second@example.com", undefined],
    ]);
    expect(groups[0].accounts.map((a) => [a.name, a.authUser, a.pageId, a.handle, a.selected])).toEqual([
      ["Main", 0, undefined, "@main", true],
      ["Brand", 0, "123456", "@brand", false],
    ]);
    expect(groups[1].accounts[0]).toMatchObject({ name: "Second", authUser: 1, byline: "2 subscribers" });
    expect(groups[0].accounts[0].photo).toContain("=s96-");
  });

  it("returns nothing for garbage", () => {
    expect(parseAccountSwitcher("")).toEqual([]);
    expect(parseAccountSwitcher(")]}'\n{}")).toEqual([]);
    expect(parseAccountSwitcher('{"actions":[{"getMultiPageMenuAction":{"menu":{"multiPageMenuRenderer":{"sections":[{}]}}}}]}')).toEqual([]);
  });
});

describe("account choice", () => {
  it("normalizes stored values", () => {
    expect(normalizeChoice({ authUser: 1, pageId: "42" })).toEqual({ authUser: 1, pageId: "42" });
    expect(normalizeChoice({ authUser: -1, pageId: "x" })).toEqual({ authUser: 0 });
    expect(normalizeChoice(null)).toEqual({ authUser: 0 });
  });

  it("compares session index and page id", () => {
    expect(sameAccount({ authUser: 0 }, { authUser: 0, pageId: undefined })).toBe(true);
    expect(sameAccount({ authUser: 0 }, { authUser: 0, pageId: "1" })).toBe(false);
  });
});
