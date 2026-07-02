import { describe, expect, it } from "bun:test";
import { validateEditInput } from "./video-edit";

describe("validateEditInput", () => {
	it("requires libraryFileId for single-source operations", () => {
		expect(() => validateEditInput({ workspaceId: "w1", operation: "trim" })).toThrow(
			/libraryFileId is required/,
		);
		expect(() => validateEditInput({ workspaceId: "w1", operation: "mute" })).toThrow(
			/libraryFileId is required/,
		);
	});

	it("requires at least two libraryFileIds for concat, and doesn't require libraryFileId", () => {
		expect(() =>
			validateEditInput({ workspaceId: "w1", operation: "concat", libraryFileIds: ["a"] }),
		).toThrow(/concat needs at least two/);
		expect(() =>
			validateEditInput({
				workspaceId: "w1",
				operation: "concat",
				libraryFileIds: ["a", "b"],
			}),
		).not.toThrow();
	});

	it("rejects endSeconds at or before startSeconds", () => {
		expect(() =>
			validateEditInput({
				workspaceId: "w1",
				operation: "trim",
				libraryFileId: "f1",
				startSeconds: 5,
				endSeconds: 5,
			}),
		).toThrow(/endSeconds must be greater than startSeconds/);
		expect(() =>
			validateEditInput({
				workspaceId: "w1",
				operation: "trim",
				libraryFileId: "f1",
				startSeconds: 5,
				endSeconds: 2,
			}),
		).toThrow(/endSeconds must be greater than startSeconds/);
	});

	it("accepts a valid trim range", () => {
		expect(() =>
			validateEditInput({
				workspaceId: "w1",
				operation: "trim",
				libraryFileId: "f1",
				startSeconds: 2,
				endSeconds: 5,
			}),
		).not.toThrow();
	});

	it("rejects a negative volume and a non-positive speed", () => {
		expect(() =>
			validateEditInput({ workspaceId: "w1", operation: "volume", libraryFileId: "f1", volume: -1 }),
		).toThrow(/volume must be 0 or greater/);
		expect(() =>
			validateEditInput({ workspaceId: "w1", operation: "speed", libraryFileId: "f1", speed: 0 }),
		).toThrow(/speed must be greater than 0/);
	});

	it("accepts extractFrame/toGif with just a libraryFileId", () => {
		expect(() =>
			validateEditInput({ workspaceId: "w1", operation: "extractFrame", libraryFileId: "f1" }),
		).not.toThrow();
		expect(() =>
			validateEditInput({ workspaceId: "w1", operation: "toGif", libraryFileId: "f1" }),
		).not.toThrow();
	});
});
