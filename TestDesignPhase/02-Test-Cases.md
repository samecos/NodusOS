# Nodus 测试用例 (Test Cases)

> 版本: v1.0 | 日期: 2026-05-04 | TDD: Red-Green-Refactor

---

## 测试用例编号规范

```
TC-{层级}-{模块}-{序号}

层级: UT=单元测试, IT=集成测试, CT=确认测试, PT=性能测试
模块: KS=KnowledgeStore, CI=CodeIntel, IE=IntentEngine, CM=ContextMgr,
      EM=EnvMgr, GI=GitIntel, VP=VoicePipe, FW=FileWatcher,
      UI=UIRenderer, SH=Shell, EB=EventBus
```

---

# Part A: 单元测试 (Unit Tests)

## A.1 Knowledge Store (TC-UT-KS)

### TC-UT-KS-001: 插入单个符号
```
GIVEN 空的 KnowledgeStore
WHEN  调用 symbols_upsert([symbol{name:"foo", kind:function, file:"a.ts", line:1}])
THEN  返回 Ok(1)
AND   symbols_find_by_name("foo") 返回 1 个结果
AND   结果的 name="foo", kind=function
```

### TC-UT-KS-002: 批量插入符号 — 幂等性
```
GIVEN 已有一个符号 sym_A (id="hashA")
WHEN  再次调用 symbols_upsert([sym_A])
THEN  返回 Ok(1)  (upsert, 不重复)
AND   symbols_find_by_name 返回 1 个结果 (不是2个)
```

### TC-UT-KS-003: 按文件删除符号
```
GIVEN 文件 a.ts 有 3 个符号，文件 b.ts 有 2 个符号
WHEN  调用 symbols_remove("a.ts")
THEN  返回 Ok(3)
AND   symbols_find_by_file("a.ts") 返回 0 个结果
AND   symbols_find_by_file("b.ts") 返回 2 个结果 (不受影响)
```

### TC-UT-KS-004: 按名称模糊查找
```
GIVEN 符号: "getUserByEmail", "getUserById", "getOrderById"
WHEN  调用 symbols_find_by_name("getUser", limit=10)
THEN  返回 2 个结果 ("getUserByEmail", "getUserById")
AND   "getOrderById" 不在结果中
```

### TC-UT-KS-005: 按种类过滤
```
GIVEN 文件中有 function x3, class x1, variable x5
WHEN  调用 symbols_find_by_name(file="a.ts", kind=Some(function))
THEN  只返回 function 类型的符号
```

### TC-UT-KS-006: 按文件查找符号
```
GIVEN 文件 a.ts 有符号: fn_a, fn_b, ClassX
WHEN  调用 symbols_find_by_file("a.ts")
THEN  返回 3 个符号
AND   按 line_start 升序排列
```

### TC-UT-KS-007: 按模块路径查找
```
GIVEN 符号分布在 src/auth/ (5个) 和 src/payment/ (3个)
WHEN  调用 symbols_find_by_module("src/auth")
THEN  返回 5 个符号 (仅 auth 模块)
```

### TC-UT-KS-008: 模糊搜索
```
GIVEN 符号: "refundOrder", "orderRefund", "processRefund"
WHEN  调用 symbols_search("refund", limit=10)
THEN  返回 3 个结果，按匹配度排序
```

### TC-UT-KS-009: 插入引用关系
```
GIVEN 2个已存在的符号 sym_A 和 sym_B
WHEN  调用 refs_upsert([ref{source:A, target:B, kind:call, file:"a.ts", line:42}])
THEN  返回 Ok(1)
AND   refs_find_by_target(B) 返回包含该引用的列表
```

### TC-UT-KS-010: 按目标查引用
```
GIVEN sym_B 被 sym_A, sym_C, sym_D 三处引用
WHEN  调用 refs_find_by_target(sym_B.id)
THEN  返回 3 条引用记录
```

### TC-UT-KS-011: 按来源查引用
```
GIVEN sym_A 调用了 sym_B, sym_C, sym_D
WHEN  调用 refs_find_by_source(sym_A.id)
THEN  返回 3 条引用记录
```

### TC-UT-KS-012: 删除文件时级联删除引用
```
GIVEN 文件 a.ts 中有 5 条引用关系
WHEN  调用 refs_remove_for_file("a.ts")
THEN  返回 Ok(5)
AND   这 5 条引用不再存在于数据库中
```

### TC-UT-KS-013: 存储和获取调用图
```
GIVEN 一个包含 5 个节点、6 条边的 CallGraph
WHEN  调用 callgraph_store(graph)
AND   调用 callgraph_get(root_id, Both, 3)
THEN  返回的 CallGraph 节点和边与存储的一致
```

### TC-UT-KS-014: 单文件调用图重建
```
GIVEN 调用图中包含文件 a.ts 和 b.ts 之间的调用边
WHEN  调用 callgraph_rebuild_for_file("a.ts")
THEN  涉及 a.ts 的调用边被更新
AND  仅涉及 b.ts 内部的调用边不受影响
```

### TC-UT-KS-015: 项目 CRUD
```
GIVEN 空的 projects 表
WHEN  调用 project_upsert(meta{root:"/home/dev/myapp", languages:["typescript"]})
AND   调用 project_get("/home/dev/myapp")
THEN  返回 Some(meta) 且 languages 包含 "typescript"
AND   调用 project_list() 返回 1 个项目
```

### TC-UT-KS-016: 用户偏好读写
```
GIVEN 偏好 key "voice.wake_word" 不存在
WHEN  调用 pref_get("voice.wake_word")
THEN  返回 Ok(None)
WHEN  调用 pref_set("voice.wake_word", "\"Nodus\"")
AND   调用 pref_get("voice.wake_word")
THEN  返回 Ok(Some("Nodus"))
```

### TC-UT-KS-017: 查询历史记录
```
GIVEN 空的查询历史
WHEN  调用 history_record(QueryHistoryEntry{raw_text:"find refundOrder", ...})
AND   调用 history_recent(10)
THEN  返回 1 条记录，raw_text="find refundOrder"
```

### TC-UT-KS-018: 查询历史截断
```
GIVEN 已有 100 条查询历史
WHEN  调用 history_recent(5)
THEN  返回最近 5 条记录，按时间戳倒序
```

---

## A.2 Code Intelligence (TC-UT-CI)

### TC-UT-CI-001: TypeScript 文件解析 — 提取函数符号
```
GIVEN TypeScript 源文件内容:
     "export async function refundOrder(orderId: string): Promise<RefundResult> { ... }"
WHEN  LanguageParser(typescript).parse(source) → extract_symbols(ast)
THEN  返回 1 个 Symbol {name:"refundOrder", kind:function, is_exported:true, language:typescript}
AND   signature 包含 "orderId: string"
```

### TC-UT-CI-002: TypeScript — 提取类和方法
```
GIVEN TypeScript 源文件含 class PaymentService { refund() { } }
WHEN  提取符号
THEN  返回 2 个 Symbol:
     - PaymentService (kind:class, parent_id:null)
     - refund (kind:method, parent_id:PaymentService.id)
```

### TC-UT-CI-003: TypeScript — 提取引用关系
```
GIVEN 源文件: "import { refundOrder } from './payment'; refundOrder(amount);"
WHEN  提取引用
THEN  返回 1 条 Reference {kind:call, target_name:"refundOrder"}
     和 1 条 Reference {kind:import, target_name:"refundOrder"}
```

### TC-UT-CI-004: Python 文件解析 — 提取函数符号
```
GIVEN Python 源文件: "def refund_order(order_id: str) -> RefundResult:\n    ..."
WHEN  LanguageParser(python).parse(source)
THEN  提取 1 个 Symbol {name:"refund_order", kind:function, language:python}
```

### TC-UT-CI-005: Python — 提取类和方法
```
GIVEN Python: "class PaymentService:\n    def refund(self, amount): ..."
THEN  提取 class PaymentService + method refund (parent_id=PaymentService.id)
```

### TC-UT-CI-006: Python — 提取调用关系
```
GIVEN Python: "from payment import refund_order\nrefund_order(100)"
THEN  提取 import 引用 + call 引用
```

### TC-UT-CI-007: JavaScript — 提取箭头函数和变量
```
GIVEN JS: "const refund = async (orderId) => { ... }"
THEN  提取 Symbol {name:"refund", kind:variable} (变量赋值了箭头函数)
```

### TC-UT-CI-008: 解析语法错误文件 — 务实降级
```
GIVEN 包含语法错误的 TypeScript 文件 (缺闭合括号)
WHEN  LanguageParser.parse(source)
THEN  返回 Err(ParseError { message, line, col })
AND   不 panic
```

### TC-UT-CI-009: 编码错误的文件
```
GIVEN 非 UTF-8 编码的源文件
WHEN  尝试解析
THEN  返回 ParseError
AND   上层 index_project 应跳过该文件并记录到 IndexReport.errors
```

### TC-UT-CI-010: 空文件的处理
```
GIVEN 空文件 (0 bytes)
WHEN  parse → extract_symbols
THEN  返回空 Vec (不是错误)
```

### TC-UT-CI-011: 大文件截断保护
```
GIVEN 源文件超过配置的 max_file_size_kb (默认500KB)
WHEN  index_file 被调用
THEN  跳过该文件
AND   在 IndexReport 中记录 "file too large"
```

### TC-UT-CI-012: 全量索引 — 统计正确
```
GIVEN 测试项目含 5 个 .ts 文件，共 200 个符号，400 条引用
WHEN  调用 index_project(root, [typescript])
THEN  返回 IndexReport { files_indexed:5, symbols_found:200, references_found:400 }
```

### TC-UT-CI-013: 全量索引 — 跳过 node_modules
```
GIVEN 项目含 src/ (200符号) 和 node_modules/ (10,000符号)
WHEN  调用 index_project (exclude_patterns: ["**/node_modules/**"])
THEN  只索引 src/ 的符号
AND  返回 files_indexed 不含 node_modules 中的文件
```

### TC-UT-CI-014: 增量索引 — 文件修改
```
GIVEN 文件 a.ts 已索引 (含 10 个符号)
WHEN  修改 a.ts 内容，调用 index_file("a.ts")
THEN  旧符号全部删除，新符号全部插入
AND  更新 file_index_state.checksum
```

### TC-UT-CI-015: 增量索引 — 文件未变更跳过
```
GIVEN 文件 a.ts 的 checksum 与上次索引一致
WHEN  调用 index_file("a.ts")
THEN  不执行解析和更新
AND  返回 FileIndexResult { symbols_added: 0, symbols_removed: 0 }
```

### TC-UT-CI-016: 增量索引 — 调用图边更新
```
GIVEN a.ts 的 fnA 调用 b.ts 的 fnB
WHEN  a.ts 修改后 fnA 不再调用 fnB
AND   调用 index_file("a.ts")
THEN  调用图不再包含 fnA → fnB 的边
```

### TC-UT-CI-017: find_symbol — 精确匹配
```
GIVEN 索引中包含符号 "refundOrder"
WHEN  调用 find_symbol("refundOrder")
THEN  返回 1 个符号，name="refundOrder"
```

### TC-UT-CI-018: find_symbol — 模糊匹配
```
GIVEN 符号: "getRefundOrder", "refundOrder", "orderRefund"
WHEN  调用 find_symbol("refund")
THEN  返回 3 个结果
```

### TC-UT-CI-019: find_symbol — 无匹配
```
GIVEN 索引中无符号 "nonexistent"
WHEN  调用 find_symbol("nonexistent")
THEN  返回 Ok([]) (空数组，不是错误)
```

### TC-UT-CI-020: find_references — 正常查找
```
GIVEN 符号 refundOrder 被 14 处调用
WHEN  调用 find_references(refundOrder.id)
THEN  返回 14 条 Reference
```

### TC-UT-CI-021: find_references — 无引用
```
GIVEN 符号 unusedHelper 未被任何地方调用
WHEN  调用 find_references(unusedHelper.id)
THEN  返回 Ok([])
```

### TC-UT-CI-022: call_graph — callers 方向
```
GIVEN payment.refundOrder() 被 controller.postRefund() 和 webhook.onRefund() 调用
WHEN  调用 call_graph(refundOrder.id, Callers, 3)
THEN  返回 2 个 caller 节点
```

### TC-UT-CI-023: call_graph — callees 方向
```
GIVEN refundOrder() 调用了 gateway.submitRefund() 和 audit.logRefund()
WHEN  调用 call_graph(refundOrder.id, Callees, 3)
THEN  返回 2 个 callee 节点
```

### TC-UT-CI-024: call_graph — 超过最大节点数截断
```
GIVEN 调用图超过 200 节点
WHEN  调用 call_graph(root, Both, 99) (max_depth=99, 几乎无限)
THEN  返回最多 200 节点
AND   标注 has_more: true
```

### TC-UT-CI-025: symbols_in_file — 正常
```
GIVEN 文件 payment.service.ts 含 8 个函数、1 个 class、3 个 type
WHEN  调用 symbols_in_file("src/payment.service.ts")
THEN  返回 12 个符号，按行号排序
```

### TC-UT-CI-026: impact_analysis — 计算影响范围
```
GIVEN User 接口被 17 个文件引用
WHEN  调用 impact_analysis(User.id)
THEN  返回 direct_callers 列表 + transitive_callers + affected_files
AND   risk_level 根据影响范围计算 (17 files → High)
```

### TC-UT-CI-027: index_status — 状态转换
```
GIVEN 新创建的 CodeIntelligence
WHEN  调用 index_status()
THEN  返回 IndexStatus::Idle
WHEN  调用 index_project() (不 await)
AND   立即调用 index_status()
THEN  返回 IndexStatus::Scanning 或 Indexing
```

### TC-UT-CI-028: query — 路由正确性
```
GIVEN QueryIntent {intent_type: FindReferences, entities: {symbol_name: "refundOrder"}}
WHEN  调用 query(intent)
THEN  返回 QueryResult::ReferenceList
```

### TC-UT-CI-029: 多语言项目索引
```
GIVEN 项目含 3 个 .ts 文件 + 2 个 .py 文件
WHEN  调用 index_project(root, [typescript, python])
THEN  两个语言的符号都被提取
AND   跨语言的引用也被记录 (Python 调用 TypeScript 的情况标记为跨语言引用)
```

### TC-UT-CI-030: 索引未就绪时查询
```
GIVEN CodeIntelligence 尚未索引任何项目
WHEN  调用 find_symbol("anything")
THEN  返回 Err(CodeIntelError::ProjectNotIndexed)
```

---

## A.3 Intent Engine (TC-UT-IE)

### TC-UT-IE-001: 定义定位意图 — 中文
```
GIVEN input="getUserByEmail在哪里定义的", locale="zh-CN"
WHEN  parse(input, context)
THEN  intent_type = FindDefinition
AND   entities.symbol_name = Some("getUserByEmail")
AND   confidence >= 0.8
```

### TC-UT-IE-002: 定义定位意图 — 英文
```
GIVEN input="where is refundOrder defined", locale="en-US"
WHEN  parse(input, context)
THEN  intent_type = FindDefinition
AND   entities.symbol_name = Some("refundOrder")
```

### TC-UT-IE-003: 引用查找意图
```
GIVEN input="refundOrder被哪些地方调用了"
WHEN  parse()
THEN  intent_type = FindReferences
AND   entities.symbol_name = Some("refundOrder")
```

### TC-UT-IE-004: 调用链路意图
```
GIVEN input="从login接口到数据库查询的完整链路是什么"
WHEN  parse()
THEN  intent_type = CallGraph
AND   entities.symbol_name = Some("login")
```

### TC-UT-IE-005: 影响分析意图
```
GIVEN input="如果我改了User模型，哪些文件会受影响"
WHEN  parse()
THEN  intent_type = ImpactAnalysis
AND   entities.symbol_name = Some("User")
```

### TC-UT-IE-006: 变更历史意图 — 指定模块和时间
```
GIVEN input="auth模块最近一周改了什么"
WHEN  parse()
THEN  intent_type = ChangeHistory
AND   entities.module_name = Some("auth")
AND   entities.time_range = Some(7天)
```

### TC-UT-IE-007: 符号概览意图
```
GIVEN input="payment.service.ts里有哪些导出函数"
WHEN  parse()
THEN  intent_type = SymbolOverview
AND   entities.file_path 包含 "payment.service.ts"
```

### TC-UT-IE-008: 上下文自动补全 — 光标在符号上
```
GIVEN input="这个函数被哪里调用了"
AND   context.cursor_symbol = Some("refundOrder")
WHEN  parse()
THEN  entities.symbol_name = Some("refundOrder") (从上下文补全)
```

### TC-UT-IE-009: 上下文自动补全 — 选中代码
```
GIVEN input="这段代码的调用链路"
AND   context.selected_code = Some("refundOrder(amount)")
WHEN  parse()
THEN  系统从 selected_code 中提取符号名 "refundOrder"
```

### TC-UT-IE-010: 歧义 — 信息不足
```
GIVEN input="把那个改一下" (无上下文)
AND   context.cursor_symbol = None, context.selected_code = None
WHEN  parse()
THEN  返回 Err(Ambiguous { candidates }) 或 Err(Unparseable)
```

### TC-UT-IE-011: 歧义 — 有上下文时倾向上下文
```
GIVEN input="这个被哪些地方调用了"
AND   context.cursor_symbol = Some("refundOrder")
AND   context.selected_code = None
WHEN  parse()
THEN  confidence >= 0.8 (上下文提供了足够信息)
AND   entities.symbol_name = Some("refundOrder")
```

### TC-UT-IE-012: 空输入
```
GIVEN input.text = "" (误触发)
WHEN  parse()
THEN  Err(EmptyInput)
```

### TC-UT-IE-013: 不支持的意图 — 代码生成
```
GIVEN input="帮我生成一个User类的CRUD方法" (MVP不支持代码生成)
WHEN  parse()
THEN  Err(UnsupportedIntent { intent_type: "code_generation" })
```

### TC-UT-IE-014: resolve_ambiguity
```
GIVEN candidates = [intentA, intentB, intentC]
WHEN  resolve_ambiguity(candidates, chosen_index=1)
THEN  返回 intentB
```

### TC-UT-IE-015: record_feedback — 从歧义中学习
```
GIVEN parse() 返回 Ambiguous
WHEN  record_feedback(input, parsed=None, actual=用户选择的intent)
THEN  内部模型更新: 这种模糊输入更可能指向 actual 类型的意图
```

---

## A.4 Context Manager (TC-UT-CM)

### TC-UT-CM-001: 初始状态
```
GIVEN 新 ContextManager
WHEN  snapshot()
THEN  active_file = None, cursor_line = None, active_project_root = ""
```

### TC-UT-CM-002: 文件打开更新
```
WHEN  update(FileOpened { path: "src/main.ts" })
THEN  snapshot().active_file = Some("src/main.ts")
```

### TC-UT-CM-003: 光标移动更新
```
WHEN  update(CursorMoved { file:"src/main.ts", line:42, col:10, symbol:Some("main") })
THEN  snapshot().cursor_line = Some(42)
AND   snapshot().cursor_symbol = Some("main")
```

### TC-UT-CM-004: 选中代码更新
```
WHEN  update(SelectionChanged { file:"a.ts", range:(10,15), code:"refundOrder()" })
THEN  snapshot().selected_code = Some("refundOrder()")
AND   snapshot().selected_range = Some((10,15))
```

### TC-UT-CM-005: 项目切换
```
WHEN  update(ProjectChanged { root: "/home/dev/newproject" })
THEN  snapshot().active_project_root = "/home/dev/newproject"
AND   active_file 被清空 (切换项目后上一个文件不再有效)
```

### TC-UT-CM-006: 最近查询追踪
```
GIVEN snapshot().recent_queries 最多保留 5 条
WHEN  连续记录 7 条查询
THEN  recent_queries.len() = 5
AND   保留的是最近的 5 条
```

### TC-UT-CM-007: 上下文更新触发事件
```
GIVEN EventBus 订阅了 ContextChanged
WHEN  update(FileOpened { path: "a.ts" })
THEN  EventBus 收到 ContextChanged { delta: FileOpened { path: "a.ts" } }
```

---

## A.5 Environment Manager (TC-UT-EM)

### TC-UT-EM-001: 识别 TypeScript 项目
```
GIVEN 目录含 package.json (dependencies 含 "typescript") 和 tsconfig.json
WHEN  detect_project(path)
THEN  ProjectMeta.languages 包含 TypeScript
AND   ProjectMeta.framework = None (纯TS项目，非Next/React等)
```

### TC-UT-EM-002: 识别 Next.js 项目
```
GIVEN 目录含 package.json (dependencies 含 "next") 和 next.config.js
WHEN  detect_project(path)
THEN  ProjectMeta.languages 包含 TypeScript
AND   ProjectMeta.framework = Some(NextJs)
```

### TC-UT-EM-003: 识别 Python 项目 — pyproject.toml
```
GIVEN 目录含 pyproject.toml ([project] name="myapp", requires-python=">=3.12")
WHEN  detect_project(path)
THEN  languages 包含 Python
AND   runtimes 含 {language:Python, constraint:">=3.12", specified_in:"pyproject.toml"}
```

### TC-UT-EM-004: 识别 Python 项目 — requirements.txt
```
GIVEN 目录含 requirements.txt (无 pyproject.toml)
WHEN  detect_project(path)
THEN  languages 包含 Python
AND   package_manager = Pip
```

### TC-UT-EM-005: 混合项目 (TS + Python)
```
GIVEN 目录同时含 package.json 和 pyproject.toml
WHEN  detect_project(path)
THEN  languages = [TypeScript, Python]
AND   两种语言的依赖都被识别
```

### TC-UT-EM-006: 无法识别的项目
```
GIVEN 目录不含任何已知依赖文件
WHEN  detect_project(path)
THEN  Err(UnknownProjectType)
```

### TC-UT-EM-007: 检测包管理器 — npm
```
GIVEN 目录含 package-lock.json
WHEN  detect_package_manager(path)
THEN  Some(Npm)
```

### TC-UT-EM-008: 检测包管理器 — pnpm
```
GIVEN 目录含 pnpm-lock.yaml
WHEN  detect_package_manager(path)
THEN  Some(Pnpm)
```

### TC-UT-EM-009: 检测包管理器 — Poetry
```
GIVEN pyproject.toml 含 [tool.poetry]
WHEN  detect_package_manager(path)
THEN  Some(Poetry)
```

### TC-UT-EM-010: 运行时已安装且版本匹配
```
GIVEN 系统已安装 Node 22.5.1
WHEN  check_runtime(TypeScript, ">=18.0.0")
THEN  RuntimeStatus::Installed { version: "22.5.1" }
```

### TC-UT-EM-011: 运行时未安装
```
GIVEN 系统未安装 Python
WHEN  check_runtime(Python, ">=3.11")
THEN  RuntimeStatus::NotInstalled { required: "3.11" }
```

### TC-UT-EM-012: 运行时版本过旧
```
GIVEN 系统安装 Node 16.0.0
WHEN  check_runtime(TypeScript, ">=18.0.0")
THEN  RuntimeStatus::Outdated { current: "16.0.0", required: "18.0.0" }
```

---

## A.6 Git Intelligence (TC-UT-GI)

### TC-UT-GI-001: git log — 正常查询
```
GIVEN git repo 有 5 个 commit
WHEN  log(repo_path, scope=Directory("src/auth"), time_range=None, max_commits=10)
THEN  返回 5 个 CommitInfo
AND   按时间倒序
```

### TC-UT-GI-002: git log — 时间过滤
```
GIVEN commit 分布在最近 30 天
WHEN  log(time_range=Some(7天前到现在))
THEN  只返回最近 7 天的 commit
```

### TC-UT-GI-003: git log — 作者过滤
```
GIVEN author "David" 有 3 个 commit, "Lisa" 有 2 个
WHEN  log(author=Some("David"))
THEN  返回 3 个 commit
```

### TC-UT-GI-004: git diff — 单个 commit
```
GIVEN commit "abc123" 修改了 2 个文件，+5 行 -3 行
WHEN  diff("abc123")
THEN  返回 DiffData { files:[2], stats:{ insertions:5, deletions:3 } }
```

### TC-UT-GI-005: git blame — 正常
```
GIVEN file.ts 第 42 行最后被 commit "def456" 修改
WHEN  blame("file.ts", 42)
THEN  返回 BlameInfo { commit_hash:"def456", author:"David", ... }
```

### TC-UT-GI-006: 非 git 仓库
```
GIVEN 目录不是 git 仓库
WHEN  调用任何 GitIntelligence 方法
THEN  Err(NotAGitRepo)
```

---

## A.7 Voice Pipeline (TC-UT-VP)

### TC-UT-VP-001: 启动语音管线
```
GIVEN 麦克风可用
WHEN  start()
THEN  后台开始监听唤醒词
AND   检测到唤醒词后发出 VoiceWakeDetected 事件
```

### TC-UT-VP-002: 停止语音管线
```
GIVEN 语音管线正在运行
WHEN  stop()
THEN  唤醒词监听停止
AND   不再发出语音事件
```

### TC-UT-VP-003: 唤醒词检测 → 录音 → 转写 (集成)
```
GIVEN 语音管线已启动
WHEN  用户说唤醒词 "Nodus"
AND   接着说 "refundOrder被哪些地方调用了"
THEN  发出 VoiceWakeDetected
AND   发出 VoiceListeningStarted
AND   发出 VoiceTranscribed { text: "refundOrder被哪些地方调用了" }
```

### TC-UT-VP-004: 无声模式切换
```
GIVEN 语音管线已启动
WHEN  set_silent_mode(true)
THEN  stop() 被内部调用
AND   唤醒词监听停止
AND   发出 SilentModeToggled { silent: true }
WHEN  set_silent_mode(false)
THEN  start() 被内部调用
```

### TC-UT-VP-005: 无麦克风
```
GIVEN 系统无麦克风设备
WHEN  microphone_available()
THEN  false
WHEN  尝试 start()
THEN  发出 VoiceError { NoMicrophone }
```

### TC-UT-VP-006: 转写失败 — 降级到文字输入
```
GIVEN STT 返回 TranscriptionFailed
WHEN  转写失败连续 3 次
THEN  发出通知: "语音似乎不太方便，已切换到文字输入模式"
AND   自动进入无声模式
```

---

## A.8 File Watcher (TC-UT-FW)

### TC-UT-FW-001: 文件创建检测
```
GIVEN FileWatcher 监听目录 /project/src
WHEN  在 /project/src 中创建文件 newfile.ts
THEN  发出 Event::FileCreated { path: "/project/src/newfile.ts" }
```

### TC-UT-FW-002: 文件修改检测
```
GIVEN FileWatcher 监听中
WHEN  修改已存在的文件 existing.ts
THEN  发出 Event::FileChanged { path: "...existing.ts", change_type: Modified }
```

### TC-UT-FW-003: 文件删除检测
```
GIVEN FileWatcher 监听中
WHEN  删除文件 old.ts
THEN  发出 Event::FileDeleted { path: "...old.ts" }
```

### TC-UT-FW-004: 防抖合并
```
GIVEN 同一文件在 500ms 内被修改 3 次
WHEN  防抖窗口结束
THEN  只发出 1 次 FileChanged 事件
```

### TC-UT-FW-005: 暂停和恢复
```
GIVEN FileWatcher 在运行
WHEN  pause()
THEN  文件变更不再触发事件
WHEN  resume()
THEN  文件变更恢复触发事件
```

### TC-UT-FW-006: 排除模式匹配
```
GIVEN patterns = ["**/*.ts", "**/*.tsx"] (只监听 TypeScript 文件)
WHEN  修改 .py 或 .json 文件
THEN  不发出事件
```

---

## A.9 UI Renderer / Shell / EventBus (TC-UT-UI / SH / EB)

### TC-UT-UI-001: 显示卡片 — 分配ID
```
WHEN  show_card(Card{type:CallGraph, ...})
THEN  卡片被分配唯一ID
AND   发出 CardShown { card_id, card_type: CallGraph }
```

### TC-UT-UI-002: 消散卡片
```
GIVEN 卡片 card_001 已显示
WHEN  dismiss_card("card_001", animated: true)
THEN  卡片从显示列表中移除
AND   发出 CardDismissed { card_id: "card_001" }
```

### TC-UT-UI-003: 卡片 TTL 自动消散
```
GIVEN Card{ttl_seconds: 5}
WHEN  卡片显示后 5 秒无交互
THEN  自动调用 dismiss_card
```

### TC-UT-UI-004: 呼吸灯状态切换
```
GIVEN 当前 BreathState::Idle
WHEN  set_breath(Listening)
THEN  状态变为 Listening (脉动动画)
WHEN  set_breath(Working)
THEN  状态变为 Working (旋转脉冲)
```

### TC-UT-EB-001: 事件发布订阅
```
GIVEN handler_a 订阅 EnvReady
WHEN  emit(EnvReady { .. })
THEN  handler_a 被调用 1 次
```

### TC-UT-EB-002: 多个订阅者
```
GIVEN handler_a 和 handler_b 都订阅 EnvReady
WHEN  emit(EnvReady { .. })
THEN  两者都被调用
```

### TC-UT-EB-003: 取消订阅
```
GIVEN handler_a 订阅 → 获得 Subscription
WHEN  Subscription 被 drop
AND   emit 对应事件
THEN  handler_a 不再被调用
```

### TC-UT-SH-001: 模块注册和获取
```
GIVEN Shell 已 bootstrap
WHEN  调用 get_module("code_intelligence")
THEN  返回 Some(Arc<dyn CodeIntelligence>)
```

### TC-UT-SH-002: 获取未注册模块
```
WHEN  调用 get_module("nonexistent")
THEN  返回 None
```

---

# Part B: 集成测试 (Integration Tests)

## B.1 Code Intelligence ↔ Knowledge Store (TC-IT-CI-KS)

### TC-IT-CI-KS-001: 索引 → 存储 → 查询 完整链路
```
GIVEN 一个含 50 文件、2000 符号的项目
WHEN  CodeIntel.index_project(root, [typescript])
THEN  KnowledgeStore 中存储了 ~2000 个符号
AND   CodeIntel.find_symbol("refundOrder") 能正确找到
AND   CodeIntel.find_references(sym.id) 返回正确引用
AND   CodeIntel.call_graph(sym.id, Both, 3) 返回正确调用图
```

### TC-IT-CI-KS-002: 增量索引一致性
```
GIVEN 项目已全量索引
WHEN  修改 1 个文件，触发 index_file
AND   调用 find_symbol 查找该文件中修改的符号
THEN  符号信息已更新 (signature 变更反映)
AND   旧的引用关系已移除，新的已添加
```

### TC-IT-CI-KS-003: 重启后索引恢复
```
GIVEN 项目已全量索引，应用关闭
WHEN  应用重新启动，KnowledgeStore 从 SQLite 恢复内存索引
AND   调用 find_symbol
THEN  查询结果与重启前一致
```

### TC-IT-CI-KS-004: 大项目索引不丢数据
```
GIVEN 500 文件、20,000 符号的项目
WHEN  index_project 完成
THEN  IndexReport.files_failed = 0
AND   symbols_found ≈ 20,000 (±2% 容差)
```

---

## B.2 Intent Engine ↔ Code Intelligence (TC-IT-IE-CI)

### TC-IT-IE-CI-001: 意图 → 查询 端到端
```
GIVEN IntentEngine.parse("refundOrder被哪些地方调用了") → FindReferences 意图
WHEN  CodeIntel.query(intent)
THEN  返回 QueryResult::ReferenceList (14条引用)
```

### TC-IT-IE-CI-002: 歧义 → 用户选择 → 查询
```
GIVEN IntentEngine.parse 返回 Ambiguous{candidates:[A,B,C]}
WHEN  resolve_ambiguity(candidates, 1) → intent_B
AND   CodeIntel.query(intent_B)
THEN  返回与 intent_B 对应的正确查询结果
```

### TC-IT-IE-CI-003: 上下文提供隐式参数 → 查询成功
```
GIVEN Context { cursor_symbol: Some("refundOrder") }
AND   用户输入 "这个函数被哪些地方调用了"
WHEN  parse() → FindReferences { symbol_name: "refundOrder" }
AND   CodeIntel.query()
THEN  正确返回 refundOrder 的引用列表
```

---

## B.3 Environment Manager ↔ Code Intelligence (TC-IT-EM-CI)

### TC-IT-EM-CI-001: 环境就绪 → 触发索引
```
GIVEN Shell 启动了完整的事件路由
WHEN  EnvMgr.detect_project + install → EnvReady 事件
THEN  CodeIntel 收到事件 → 自动开始 index_project
AND   索引完成后 CodeIntel 回复 IndexReady 事件
```

---

## B.4 File Watcher ↔ Code Intelligence (TC-IT-FW-CI)

### TC-IT-FW-CI-001: 文件修改 → 增量索引
```
GIVEN 项目已索引，FileWatcher 在监听
WHEN  外部编辑器修改了 a.ts
AND   FileWatcher 发出 FileChanged
THEN  (防抖后) CodeIntel 自动调用 index_file("a.ts")
AND   索引在 1 秒内更新完成
```

### TC-IT-FW-CI-002: 批量文件修改
```
GIVEN git checkout 切换分支，修改了 20 个文件
WHEN  FileWatcher 发出 20 次 FileChanged 事件
THEN  防抖合并后，CodeIntel 对这 20 个文件逐个调用 index_file
AND   所有 20 个文件索引完成后，发出 IndexReady
```

---

## B.5 Voice Pipeline → Intent Engine → Query (TC-IT-VP-IE-CI)

### TC-IT-VP-IE-CI-001: 语音 → 转写 → 解析 → 查询
```
GIVEN 完整事件路由已建立
WHEN  VoicePipeline 发出 VoiceTranscribed { text: "find refundOrder references" }
THEN  IntentEngine.parse 被调用 → 成功解析
AND   CodeIntel.query 被调用 → 返回结果
AND   UIRenderer.show_card 被调用 → 显示卡片
```

---

## B.6 Git Intelligence ↔ Code Intelligence (TC-IT-GI-CI)

### TC-IT-GI-CI-001: 变更历史联合查询
```
GIVEN CodeIntel.change_history(scope=Directory("src/auth"), time_range=7d, git=...)
WHEN  CodeIntel 从 KnowledgeStore 获取 auth 模块文件列表
AND   逐个调用 GitIntel.log
AND   关联每个 commit 涉及的符号
THEN  返回正确的 ChangeRecord 列表 (含 commit 信息 + 涉及的符号)
```

---

## B.7 UI Renderer 集成 (TC-IT-UI)

### TC-IT-UI-001: 查询结果 → 卡片展示 → 代码跳转
```
GIVEN 查询返回了 ReferenceList (14条引用)
WHEN  UIRenderer.show_card(ReferenceListCard)
AND   用户点击某条引用
THEN  UIRenderer.navigate_to_code 被调用
AND   代码区跳转到对应文件和行
```

---

# Part C: 确认测试 (Confirmation Tests)

确认测试验证从用户视角的完整工作流，不 mock 任何内部模块。

## C.1 用户旅程确认

### TC-CT-001: 旅程1 — 打开项目到首次查询

```
前置条件: 系统安装有 Node.js；测试项目为 medium-project (50文件, 2000符号)

步骤:
1. 启动 Nodus
2. 打开 medium-project 目录
3. 等待环境就绪卡片显示 (应 ≤ 2分钟)
4. 等待索引完成 (呼吸灯回到 Idle)
5. 语音说: "Nodus, refundOrder 在哪里定义的"
6. 观察结果卡片

验收:
- 步骤3: 环境就绪卡片显示 "Node.js ✓, 依赖 ✓"
- 步骤4: 索引在合理时间内完成 (< 30秒 for 50文件)
- 步骤6: 3秒内出现结果卡片，包含 refundOrder 的定义位置
```

### TC-CT-002: 旅程2 — 代码库导航

```
前置条件: 项目已索引

步骤:
1. 语音说: "Nodus, refundOrder 被哪些地方调用了"
2. 观察引用列表卡片
3. 点击一条引用
4. 说: "Nodus, 这个函数的完整调用链路"
5. 观察调用图卡片

验收:
- 步骤2: 卡片列出所有引用，标注可能存在问题的调用 (如参数可能为 undefined)
- 步骤3: 代码区跳转到对应位置并高亮
- 步骤5: 调用图以树状展示，可点击展开/折叠
```

### TC-CT-003: 旅程3 — 跨域调试模拟

```
前置条件: 项目中有一个已知的函数签名变更 (模拟依赖升级场景)

步骤:
1. 说: "Nodus, auth 模块最近一周改了什么"
2. 观察变更历史卡片
3. 点击标记 ⚠ 的 commit
4. 观察展开的 diff 详情

验收:
- 步骤2: 时间线展示近一周的 commit
- 步骤3-4: diff 展示不兼容的签名变更
- 每个 commit 显示涉及的符号列表
```

### TC-CT-004: 旅程4 — 协同开发 (AI 暂未实现，降级验证)

```
前置条件: MVP 不含 AI 代码生成 (v2 功能)

步骤:
1. 说: "Nodus, 如果我改了 User 模型，哪些文件会受影响"
2. 观察影响分析卡片

验收:
- 影响分析卡片列出所有受影响的文件
- risk_level 标注正确 (>15 files → High)
- 可点击受影响文件跳转查看
```

### TC-CT-005: 旅程5 — 零配置环境

```
前置条件: 删除所有本地运行时缓存

步骤:
1. 用 Nodus 打开一个 Python 项目 (含 pyproject.toml, requires-python=">=3.12")
2. 系统检测到 Python 未安装
3. 观察环境卡片: 显示安装进度
4. 等待安装完成
5. 打开一个 TypeScript 项目

验收:
- 步骤2-3: 自动安装 Python 3.12
- 步骤4: 安装完成，依赖也安装完毕
- 步骤5: TypeScript 项目也自动配置环境
- 全程用户未输入任何命令
```

### TC-CT-006: 无声模式切换

```
步骤:
1. 长按 Ctrl+Space 2 秒
2. 观察呼吸灯变为 Silent 模式
3. 说唤醒词 "Nodus"
4. 按 Ctrl+Space 唤起输入条
5. 输入 "refundOrder 在哪里"
6. 回车
7. 观察结果卡片 (文字响应，无语音)

验收:
- 步骤1-2: 提示条 "已进入无声模式"，呼吸灯变半透明
- 步骤3: 唤醒词不响应
- 步骤4-6: 文字输入可用
- 步骤7: 结果卡片正常显示
```

### TC-CT-007: 歧义反问 — 用户选择

```
前提: 准备一个上下文模糊的查询

步骤:
1. 确保没有选中代码，光标不在任何符号上
2. 说: "Nodus, 把这个改一下"
3. 观察歧义卡片
4. 说 "A" (或点击第一个选项)
5. 观察系统执行 A 选项的查询

验收:
- 步骤3: 显示 2-3 个候选选项，每个选项描述清晰
- 步骤4-5: 用户选择后正确执行
```

### TC-CT-008: 错误降级 — 语法错误的文件

```
前置条件: 项目中有一个含语法错误的 .ts 文件

步骤:
1. 打开包含错误文件的项目
2. 等待索引完成
3. 查询 "项目中有多少个函数"

验收:
- 索引不崩溃，正常完成
- 索引报告中标注了跳过的错误文件
- 正常文件的符号查询不受影响
```

### TC-CT-009: 非 Git 项目降级

```
前置条件: 项目目录没有 .git

步骤:
1. 打开项目
2. 说: "Nodus, 这个文件最近改了什么"

验收:
- 变更历史查询返回空或提示 "此目录不是 Git 仓库"
- 其他功能 (符号查询、引用查找) 正常工作
```

### TC-CT-010: 启动恢复

```
步骤:
1. 打开项目，做一次查询
2. 关闭 Nodus
3. 重新打开 Nodus
4. 观察工作区状态

验收:
- 重新打开后，上次的文件和光标位置已恢复
- 索引可用 (从 SQLite 恢复，不重新全量索引)
- 环境状态显示 "就绪"
```

---

# Part D: 性能测试 (Performance Tests)

### TC-PT-001: 10万行项目索引时间
```
GIVEN 10万行 TypeScript 代码 (~500文件, ~20,000符号)
WHEN  执行 index_project
THEN  索引时间 ≤ 30秒
```

### TC-PT-002: 查询延迟 (索引就绪后)
```
GIVEN 索引已就绪
WHEN  执行 find_references (返回 50 条引用)
THEN  延迟 ≤ 100ms (不含网络, 纯内存+SQLite)
```

### TC-PT-003: 意图解析延迟
```
GIVEN local model loaded
WHEN  IntentEngine.parse(text, context)
THEN  延迟 ≤ 200ms (P95)
```

### TC-PT-004: 内存占用
```
GIVEN 10万行项目索引在内存中
WHEN  测量进程 RSS
THEN  ≤ 200MB (含 SQLite 缓存 + 内存索引 + 应用本体)
```

### TC-PT-005: 增量索引延迟
```
GIVEN 修改了 1 个文件 (100 行)
WHEN  index_file 被调用
THEN  延迟 ≤ 500ms (含解析+更新DB+重建调用图)
```

---

## 测试覆盖矩阵

| 模块 | 单元测试数 | 集成测试数 | 确认测试覆盖 |
|------|-----------|-----------|-------------|
| Knowledge Store | 18 | 4 | CT-001~010 |
| Code Intelligence | 30 | 4 | CT-001~004,008 |
| Intent Engine | 15 | 3 | CT-003,007 |
| Context Manager | 7 | - | CT-001,010 |
| Environment Manager | 12 | 1 | CT-001,005 |
| Git Intelligence | 6 | 1 | CT-003,009 |
| Voice Pipeline | 6 | 1 | CT-001,006 |
| File Watcher | 6 | 2 | - |
| UI Renderer | 4 | 1 | CT-001~010 |
| Shell / EventBus | 5 | - | 所有CT |
| **总计** | **109** | **17** | **10** |
