import assert from "node:assert/strict";
import test from "node:test";

import {
  getBase64ByteLength,
  ImageAttachmentValidationError,
  normalizeImageAttachment,
  normalizeSelectedImageAttachment,
  toChatImageAttachment,
} from "./image-attachment.ts";

test("normalizes a native picker image and removes the data URI prefix", () => {
  const attachment = normalizeImageAttachment({
    uri: "file:///tmp/photo.jpg",
    mimeType: "image/jpg",
    base64: "data:image/jpeg;base64,SGVsbG8=",
    fileSize: 5,
    width: 1200,
    height: 800,
    name: "../photo.jpg",
  });

  assert.deepEqual(attachment, {
    uri: "file:///tmp/photo.jpg",
    mimeType: "image/jpeg",
    base64: "SGVsbG8=",
    width: 1200,
    height: 800,
    name: "photo.jpg",
  });
  assert.equal(getBase64ByteLength(attachment.base64), 5);
});

test("infers a known image type when a provider omits MIME metadata", () => {
  assert.equal(
    normalizeImageAttachment({
      uri: "content://picker/item",
      name: "scan.PNG",
      base64: "YQ==",
    }).mimeType,
    "image/png",
  );
});

test("rejects an image when either native or decoded size exceeds the limit", () => {
  assert.throws(
    () =>
      normalizeImageAttachment(
        {
          uri: "file:///tmp/photo.jpg",
          mimeType: "image/jpeg",
          base64: "SGVsbG8=",
          fileSize: 5,
        },
        { maxBytes: 4 },
      ),
    (error) =>
      error instanceof ImageAttachmentValidationError &&
      error.code === "attachment-too-large",
  );
});

test("rejects malformed Base64 and mismatched MIME metadata", () => {
  assert.throws(
    () =>
      normalizeImageAttachment({
        uri: "file:///tmp/photo.jpg",
        mimeType: "image/jpeg",
        base64: "not_base64!",
      }),
    (error) =>
      error instanceof ImageAttachmentValidationError &&
      error.code === "invalid-base64",
  );

  assert.throws(
    () =>
      normalizeImageAttachment({
        uri: "file:///tmp/photo.jpg",
        mimeType: "image/jpeg",
        base64: "data:image/png;base64,YQ==",
      }),
    (error) =>
      error instanceof ImageAttachmentValidationError &&
      error.code === "mime-type-mismatch",
  );
});

test("adapts validated picker output to the chat attachment model", () => {
  assert.deepEqual(
    toChatImageAttachment({
      id: "12345678-rest",
      uri: "file:///tmp/photo.webp",
      mimeType: "image/webp",
      base64: "YQ==",
    }),
    {
      id: "12345678-rest",
      kind: "image",
      uri: "file:///tmp/photo.webp",
      name: "image-12345678.webp",
      mimeType: "image/webp",
      base64: "YQ==",
      sizeBytes: 1,
    },
  );
});

test("selected image metadata crosses into chat without retaining Base64", () => {
  const selected = normalizeSelectedImageAttachment({
    uri: "file:///tmp/photo.jpg",
    mimeType: "image/jpeg",
    fileSize: 2_048,
    width: 1600,
    height: 900,
    name: "photo.jpg",
  });
  const chat = toChatImageAttachment({ id: "selected-one", ...selected });

  assert.equal(chat.sizeBytes, 2_048);
  assert.equal(chat.base64, undefined);
  assert.equal(Object.hasOwn(chat, "base64"), false);
});
