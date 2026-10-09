# Python vendor 发行目录

`vendor/python/macos-arm64-cp311/` 由 `./run.sh build` 在 macOS arm64 与 CPython 3.11 环境生成。该目录包含固定版本的求解与表格处理库，并生成 `SHA256SUMS` 完整性清单。

当前开发环境没有 Pyomo、HiGHS、pandas、openpyxl，也没有适合本机的打包构建工具，因此源代码工作区未携带生成后的二进制 wheel 安装目录。完成构建后，统一运行脚本只从此目录加载 Python 库，不读取用户级 site-packages。
