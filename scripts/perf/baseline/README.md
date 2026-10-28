# Export baseline

`export.ts` is a byte-preserving copy of the actual source at Nytt PR104,
`6722beceda30a82afe7229414f68865b138d623f`.
SHA-256: `963a91bf22ff3bb5f967301fbbf38f2de55ce9301547db386f1176e9e8f70930`.

The separate test image compiles this source with the existing installed TypeScript
and inherited server options. Its emitted JavaScript must exactly match the actual
production build captured before that compilation. CI retains those original
compiled bytes and compiler/configuration hashes as an artifact. Both modules use
the same production dependency tree; the baseline probe records resolved entry
paths, versions and hashes for archiver and pdfkit.

The existing native export oracle runs separately on the unchanged API image and
the baseline module, retaining all six empty/small/maximum exports and original
network, private-data, memory, scratch, timeout and cleanup checks. No production
target contains the baseline module. This is test preparation, not a performance
measurement or completion of the larger persisted-export task.
