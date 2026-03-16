{
  "targets": [
    {
      "target_name": "cerebro_core",
      "sources": [
        "src/cpp/addon.cpp",
        "src/cpp/VectorSearch.cpp",
        "src/cpp/VectorMath.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src/cpp"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/arch:AVX2"]
        }
      },
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='linux'", {
          "cflags_cc": ["-std=c++17", "-mavx2", "-mfma"]
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "OTHER_CPLUSPLUSFLAGS": ["-mavx2", "-mfma"]
          }
        }],
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++17", "/arch:AVX2"]
            }
          }
        }]
      ]
    }
  ]
}
