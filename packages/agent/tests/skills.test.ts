import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Exit, FileSystem, Path, Schema } from "effect";
import { Skills } from "../src/index.ts";

const decodeMetadata = Schema.decodeUnknownExit(Skills.Metadata, {
  onExcessProperty: "ignore",
});

describe("Skills.Metadata", () => {
  it("decodes every field in the Agent Skills frontmatter schema", () => {
    const result = decodeMetadata({
      name: "pdf-processing",
      description: "Extract and edit PDFs when a user needs document processing.",
      license: "Apache-2.0",
      compatibility: "Requires network access",
      metadata: { author: "example-org", version: "1.0" },
      "allowed-tools": "Bash(git:*) Read",
    });

    assert.isTrue(Exit.isSuccess(result));
    if (Exit.isSuccess(result)) {
      assert.strictEqual(result.value.name, "pdf-processing");
      assert.deepStrictEqual(result.value.metadata, {
        author: "example-org",
        version: "1.0",
      });
      assert.strictEqual(result.value["allowed-tools"], "Bash(git:*) Read");
    }
  });

  it.each(["-leading", "trailing-", "two--hyphens", "UPPERCASE", "has space", ""])(
    "rejects invalid skill name %j",
    (name) => {
      assert.isTrue(
        Exit.isFailure(
          decodeMetadata({
            name,
            description: "A valid description",
          }),
        ),
      );
    },
  );

  it("accepts lowercase Unicode alphanumeric names", () => {
    assert.isTrue(
      Exit.isSuccess(
        decodeMetadata({
          name: "数据分析-２",
          description: "Analyze internationalized datasets.",
        }),
      ),
    );
  });

  it("rejects invalid known fields and ignores unexpected fields", () => {
    assert.isTrue(Exit.isFailure(decodeMetadata({ name: "valid-name", description: "   " })));
    assert.isTrue(
      Exit.isFailure(
        decodeMetadata({
          name: "valid-name",
          description: "A valid description",
          metadata: { version: 1 },
        }),
      ),
    );
    const result = decodeMetadata({
      name: "valid-name",
      description: "A valid description",
      unexpected: true,
    });
    assert.isTrue(Exit.isSuccess(result));
    if (Exit.isSuccess(result)) {
      assert.isFalse("unexpected" in result.value);
    }
  });

  it("enforces the specified metadata length limits", () => {
    assert.isTrue(
      Exit.isSuccess(
        decodeMetadata({
          name: "a".repeat(64),
          description: "a".repeat(1024),
          compatibility: "a".repeat(500),
        }),
      ),
    );
    assert.isTrue(
      Exit.isFailure(
        decodeMetadata({
          name: "a".repeat(65),
          description: "A valid description",
        }),
      ),
    );
    assert.isTrue(
      Exit.isFailure(
        decodeMetadata({
          name: "valid-name",
          description: "a".repeat(1025),
        }),
      ),
    );
    assert.isTrue(
      Exit.isFailure(
        decodeMetadata({
          name: "valid-name",
          description: "A valid description",
          compatibility: "a".repeat(501),
        }),
      ),
    );
  });
});

layer(NodeServices.layer)("Skills.fromDir", (it) => {
  const writeSkill = Effect.fn(function* (root: string, name: string, frontmatter: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(root, name);
    yield* fs.makeDirectory(skillDir);
    yield* fs.writeFileString(
      path.join(skillDir, "SKILL.md"),
      `---\n${frontmatter}---\n\n# Body\n`,
    );
  });

  it.effect("discovers immediate SKILL.md files in directory-name order", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();

      yield* writeSkill(root, "zeta-skill", "name: zeta-skill\ndescription: Runs after alpha.\n");
      yield* writeSkill(
        root,
        "alpha-skill",
        [
          "name: alpha-skill",
          "description: Runs first.",
          "license: MIT",
          "metadata:",
          "  author: open-insight",
          '  version: "1.0"',
          "allowed-tools: Read Bash(git:*)",
          "client-extension: ignored",
          "",
        ].join("\n"),
      );
      yield* fs.writeFileString(path.join(root, "README.md"), "not a skill");
      yield* fs.makeDirectory(path.join(root, "no-skill-file"));

      const metadata = yield* Skills.fromDir(root);

      assert.deepStrictEqual(
        metadata.map(({ name }) => name),
        ["alpha-skill", "zeta-skill"],
      );
      assert.strictEqual(metadata[0].license, "MIT");
      assert.deepStrictEqual(metadata[0].metadata, {
        author: "open-insight",
        version: "1.0",
      });
      assert.strictEqual(metadata[0]["allowed-tools"], "Read Bash(git:*)");
      assert.isFalse("client-extension" in metadata[0]);
    }),
  );

  it.effect("fails with the SKILL.md path when the name does not match its directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      yield* writeSkill(
        root,
        "actual-directory",
        "name: different-name\ndescription: This name does not match.\n",
      );

      const error = yield* Skills.fromDir(root).pipe(Effect.flip);

      assert.instanceOf(error, Skills.InvalidMetadataError);
      assert.strictEqual(error.path, path.join(root, "actual-directory", "SKILL.md"));
    }),
  );

  it.effect("fails with a typed metadata error for malformed YAML", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const skillDir = path.join(root, "broken-skill");
      const skillFile = path.join(skillDir, "SKILL.md");
      yield* fs.makeDirectory(skillDir);
      yield* fs.writeFileString(
        skillFile,
        "---\nname: broken-skill\ndescription: [not closed\n---\n",
      );

      const error = yield* Skills.fromDir(root).pipe(Effect.flip);

      assert.instanceOf(error, Skills.InvalidMetadataError);
      assert.strictEqual(error.path, skillFile);
    }),
  );

  it.effect("fails with a typed source error when the skills directory cannot be read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const missing = path.join(root, "missing");

      const error = yield* Skills.fromDir(missing).pipe(Effect.flip);

      assert.instanceOf(error, Skills.SourceError);
      assert.strictEqual(error.path, missing);
    }),
  );
});
