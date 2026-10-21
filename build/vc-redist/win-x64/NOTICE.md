# Microsoft Visual C++ Redistributable (x64) — App-local redistribution

The following DLLs are redistributed unmodified from the official
"Microsoft Visual C++ 2015-2022 Redistributable (x64)" package
(`vc_redist.x64.exe`, version 14.44.35211):

- `msvcp140.dll`
- `msvcp140_1.dll`
- `vcruntime140.dll`
- `vcruntime140_1.dll`

They are deployed app-locally next to the `onnxruntime-node` and
`@node-rs/jieba-win32-x64-msvc` native binaries so that ONNX Runtime and Jieba can
load without requiring a separate system-wide VC++ Redistributable installation.

These files are Microsoft's "Visual C++ Redistributable" redistributable code
and are governed by the Microsoft Software License Terms for the Visual Studio
2022 Visual C++ Redistributable. They are distributed unmodified. Do not modify
or repackage these binaries; updates must be sourced from Microsoft.

SHA-256 (for verification):

- msvcp140.dll 0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9
- msvcp140_1.dll bfad5aef4c63a669e3c140655cdfdf395b6c979b400a447bd5dcb65ed8826c3d
- vcruntime140.dll d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066
- vcruntime140_1.dll 1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f
