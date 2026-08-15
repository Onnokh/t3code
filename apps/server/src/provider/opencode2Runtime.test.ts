import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import {
  buildOpenCode2BasicAuthorization,
  openCode2FailureDetail,
  parseOpenCode2ModelSlug,
  toOpenCode2DataUri,
  toOpenCode2PermissionReply,
} from "./opencode2Runtime.ts";
import { isWithinOpenCode2WorkspaceRoot, parseOpenCode2Resume } from "./Layers/OpenCode2Adapter.ts";

describe("parseOpenCode2ModelSlug", () => {
  it("splits provider and model on the first slash", () => {
    NodeAssert.deepEqual(parseOpenCode2ModelSlug("opencode/big-pickle"), {
      providerID: "opencode",
      modelID: "big-pickle",
    });
    NodeAssert.deepEqual(parseOpenCode2ModelSlug("openrouter/vendor/model"), {
      providerID: "openrouter",
      modelID: "vendor/model",
    });
  });
  it("rejects malformed slugs", () => {
    NodeAssert.equal(parseOpenCode2ModelSlug("no-slash"), null);
    NodeAssert.equal(parseOpenCode2ModelSlug("/leading"), null);
    NodeAssert.equal(parseOpenCode2ModelSlug("trailing/"), null);
    NodeAssert.equal(parseOpenCode2ModelSlug(undefined), null);
  });
});

describe("toOpenCode2PermissionReply", () => {
  it("maps T3 decisions to OpenCode replies", () => {
    NodeAssert.equal(toOpenCode2PermissionReply("accept"), "once");
    NodeAssert.equal(toOpenCode2PermissionReply("acceptForSession"), "always");
    NodeAssert.equal(toOpenCode2PermissionReply("decline"), "reject");
    NodeAssert.equal(toOpenCode2PermissionReply("cancel"), "reject");
  });
});

describe("toOpenCode2DataUri", () => {
  it("encodes bytes as a data URI", () => {
    const uri = toOpenCode2DataUri({
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });
    NodeAssert.equal(uri, `data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`);
  });
  it("refuses oversized payloads", () => {
    const uri = toOpenCode2DataUri({
      mimeType: "image/png",
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
    });
    NodeAssert.equal(uri, null);
  });
});

describe("openCode2FailureDetail — sanitization", () => {
  const password = "super-secret-password";

  it("never echoes the request (and its Authorization header) from transport errors", () => {
    const detail = openCode2FailureDetail({
      _tag: "ResponseError",
      reason: "StatusCode",
      request: {
        headers: { authorization: buildOpenCode2BasicAuthorization(password) },
      },
      response: { status: 500 },
      message: `boom ${buildOpenCode2BasicAuthorization(password)}`,
    });
    NodeAssert.ok(!detail.includes(password));
    NodeAssert.ok(!detail.includes(Buffer.from(`opencode:${password}`).toString("base64")));
    NodeAssert.ok(detail.includes("500"));
  });

  it("maps unauthorized to a password hint without credentials", () => {
    const detail = openCode2FailureDetail({ _tag: "UnauthorizedError", message: "nope" });
    NodeAssert.ok(detail.toLowerCase().includes("authentication"));
  });

  it("maps schema mismatches to a pinned-build explanation", () => {
    const detail = openCode2FailureDetail({ _tag: "SchemaError", message: "decode failed" });
    NodeAssert.ok(detail.includes("pinned"));
  });

  it("falls back to plain messages", () => {
    NodeAssert.equal(openCode2FailureDetail(new Error("plain failure")), "plain failure");
    NodeAssert.equal(openCode2FailureDetail("just text"), "just text");
    NodeAssert.equal(openCode2FailureDetail(undefined), "OpenCode 2 request failed.");
  });
});

describe("parseOpenCode2Resume", () => {
  it("accepts the current cursor shape", () => {
    NodeAssert.deepEqual(
      parseOpenCode2Resume({ schemaVersion: 1, sessionId: "ses_x", lastSeq: 12 }),
      { sessionId: "ses_x", lastSeq: 12 },
    );
    NodeAssert.deepEqual(parseOpenCode2Resume({ schemaVersion: 1, sessionId: " ses_y " }), {
      sessionId: "ses_y",
    });
  });
  it("ignores foreign or stale cursors", () => {
    NodeAssert.equal(parseOpenCode2Resume(undefined), undefined);
    NodeAssert.equal(parseOpenCode2Resume({ schemaVersion: 2, sessionId: "ses" }), undefined);
    NodeAssert.equal(parseOpenCode2Resume({ schemaVersion: 1, sessionId: "" }), undefined);
    NodeAssert.equal(parseOpenCode2Resume("ses_z"), undefined);
  });
});

describe("isWithinOpenCode2WorkspaceRoot", () => {
  it("accepts the root itself and nested paths, rejects escapes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        NodeAssert.equal(
          isWithinOpenCode2WorkspaceRoot(path, "/workspaces/code", "/workspaces/code"),
          true,
        );
        NodeAssert.equal(
          isWithinOpenCode2WorkspaceRoot(
            path,
            "/workspaces/code",
            "/workspaces/code/repo/worktree",
          ),
          true,
        );
        NodeAssert.equal(
          isWithinOpenCode2WorkspaceRoot(path, "/workspaces/code", "/workspaces/code/../secrets"),
          false,
        );
        NodeAssert.equal(isWithinOpenCode2WorkspaceRoot(path, "/workspaces/code", "/etc"), false);
      }).pipe(Effect.provide(NodeServices.layer)),
    ));
});
