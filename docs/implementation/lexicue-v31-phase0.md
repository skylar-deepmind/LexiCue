# PRD 3.1 / 纯 B v3：基线与迁移映射

2026-10-24（Asia/Shanghai）。依据：实施交接全文、根 AGENTS.md、PRD 3.1 正文、integrated-b-v3 的 design / STORYBOARD / README / motion 源码。

## 工作区保护

- 起点 `22d05a0bbb14ecffe639007da16bb4a4d162ebf7`，独立分支 `codex/lexicue-v31-pure-b`。不推送到 main。
- 用户原有 AGENTS.md、marketing、design-previews、docs/research 和交接文件保持原样。未提交文件共 1,574 个、204,208,990 字节，校验清单及 tracked patch 在 `/tmp/lexicue-v31-baseline-20261024/`，这是本机临时保护证据，不提交真实数据到 Git。
- 本机学习库仅经 SQLite 只读连接备份到上述临时目录；所有迁移验收使用副本或自动生成的测试库。开发浏览器 fixture 不接真实库；不启动使用默认数据目录的 Tauri 应用做破坏性测试。
- 三个边界不再重议：不做文件夹；仅有主动积累证据的旧英语内容迁入；引导最多三步、实操、可随时跳过。

## 代码差距与复用

| 领域 | 现状与处理 |
| --- | --- |
| 保存粒度 | 旧 words / phrases 是词条；occurrences 依赖 segments / files 级联。新增独立上下文副本，不改旧结构、不使用原句 JOIN 充当保存。 |
| 人工编辑证据 | words.rs / phrases.rs 的 update_*_definition、词条合并保留的个人注释是 definition 写入路径；AI 写 meaning_* 与词典缓存，不写 definition。meaning_edited / meaning_en_edited 只在人编辑时置 1。dictionary.rs 的 other_senses_*_edited 同样是人工编辑，完整保留。 |
| 复习耦合 | annotations::save_status 在 learning 时建卡；新保存命令完全独立，不调用该链。旧计划和日志保留。退出旧写入口在阅读主流程批次处理，不把旧计划删掉。 |
| 导入 | 本地 multiple:false，语言与预览是额外步骤；须改成逐文件队列。保留当前解析、标签、YouTube 英语能力；真实读取/解析/提交反馈，提交后才算成功。 |
| 阅读 | 当前词、短语、纯查询三套解释。复用 UTF-16 reader spans、统一返回层、阅读位置、TTS；统一卡片另接新保存。 |
| 同步 | 材料以 library_item 快照同步；保存使用独立 saved_records 加密实体，不依赖材料到达或存在。服务端已支持合法名称的实体，无需新增平台。 |
| 兼容 | TXT、多语言、文件夹兼容字段、旧模型、计划、作答、标签仍留原表及备份。旧数据只读查看/导出入口在设置收敛批次交付。 |

## 迁移规则与映射

候选为 `language='en'` 且至少一个证据成立：`status='learning'`、`phrases.source='manual'`、`definition IS NOT NULL`、任一原句的 `meaning_edited=1` / `meaning_en_edited=1`，或人工编辑的扩展义。非空 AI 解释、词频、导入、known / ignored 均不单独构成主动保存。

annotation_actions 是状态操作回执，不是独立收藏实体。现有回执里两条 learning 与当前状态一致，其他回执为 known；不从历史状态或回执 ID 猜测保存时间，不扩大迁入范围。

| 旧字段 | 新保存快照 |
| --- | --- |
| lemma / text | expression、统一大小写与空白后的 normalized_expression；不猜词形 |
| 每个现存 occurrence | 一条按表达与来源位置去重的快照；同词不同原句分别保留，包括旧隐藏状态的元数据 |
| en_text / zh_text | 独立 sentence / sentence_translation 副本，无外键 |
| file name / hash、segment index、position | source 副本；token position 转可核验 UTF-16 偏移，不能对应时保留 legacy-position，而非猜位置 |
| 原句 meaning_edited | 本句个人解释优先；其次词条个人注释，再次个人英语解释，再次已有 AI 本句解释；来源明确标记 |
| definition、usage、英语修改、扩展义、token_positions、分析元数据 | legacy JSON 完整保留；不把个人注释或扩展义压成一个字段后丢弃其余内容 |
| 无 occurrence 的主动条目 | 一条来源缺失记录，sentence/source=null；说明原库已缺失，不能凭空补句 |
| 保存时间未知 | saved_at=null，排序稳定放在已知时间之后；updated_at 仅是系统版本时间，不显示为旧保存日期 |

只读副本核对：27 份材料、7,246 个旧单词、2,027 个旧短语、89,015 / 3,579 条词/短语出现记录。候选 123 个英语单词、44 个英语短语；976 条现存上下文，27 个无来源条目（3 词、24 短语）。实际另有 5 条同表达同位置重复记录，得到 998 个独立保存身份；重复位置的全部旧内容保存在同一快照的附加旧记录中。其他内容保留历史及原因；旧外键检查 0 处违规。以上仅是本机副本统计，不是测试假数据，也不向仓库提交词句内容。

幂等：`record_id = SHA-256(normalized_expression, source_key)`；数据库唯一约束保护同表达同位置；迁移版本标记和所有记录同一事务提交。重复执行不改个人解释、不复活已移除保存。全局迁移标记只表示这次升级；恢复旧备份时重新生成，恢复新版备份时恢复标记和删除墓碑。

## 备份、撤销与同步契约

- 升级前使用 SQLite `VACUUM INTO` 做一致性数据库备份（含 WAL 已提交内容），写入数据目录 backups；备份失败即停止产品迁移。自动化用临时目录验证。
- 保存、编辑、移除及回执在 `BEGIN IMMEDIATE` 事务中提交。同操作 ID 可重试；撤销校验目标 revision，仅还原本次变更；重复保存的撤销不能删既有记录。失败回滚，无半条快照或半条回执。
- 移除保留快照和墓碑；undo 恢复相同 record_id、原句、解释、来源、原保存时间，仅更新系统版本。旧异步查询无法写入个人解释。
- JSON 备份 schema 9，新增独立快照、操作回执、冲突双方、迁移报告。兼容 1–8 及逐行缺省的新字段；恢复与旧数据迁移在同一事务中完成，新备份保留稳定身份和墓碑。旧 category 列只作备份兼容，不增加分类入口。
- 加密同步使用 saved_records 独立实体；源材料删除不影响保存。每个生命周期 epoch 中删除优先于并发编辑；明确撤销/重新保存进入下一 epoch。冲突保留双方快照到现有 sync_conflicts 并可在界面看见，个人解释不被自动结果覆盖。跨设备 HTTP/账号验收单列，不能用本机合并测试冒充完成。

## 分批与估算

1. 数据底座：实体、迁移、事务撤销、备份、同步合并，先过真实 SQLite 回归；再交付可操作的已保存管理入口。约 1–2 个开发批次。
2. B 主流程：坞、英语批量导入、真实逐文件状态、画廊/列表、路径、同一解释区、朗读、继续位置、真实保存。约 2 个批次。
3. 再遇闭环：索引、匹配边界、点击回顾、多上下文、提示开关、万条性能。约 1–2 个批次。
4. 最多三步可跳过实操、旧记录入口和设置收敛、双主题及平台回归。约 1–2 个批次；目标用户试用另需一周及参与者配合。

这是按现有代码差距给出的工作量范围，不代表所有 P0 已交付，也不等同于固定日历承诺。

## 验收基线

- 固定源码版本起点如上。前端基线：28 个文件、186 测试通过；build 通过；lint 无错误、12 条既有警告（主要来自 marketing / 设计演示及既有控制字符正则）。不修改无关用户文件来消除警告。
- Rust 初次受沙箱 localhost 监听限制：198 passed / 18 failed / 11 ignored；允许本地测试监听后基线为 216 单元测试及 4 数据库集成测试通过，11 项原有测试跳过。
- 固定材料：`fixtures/v31-reading.srt`；缺来源、多语言、人工修改、失败/中断在 Rust 临时库中构造。真实学习库不作为破坏性 fixture。
- 测试主机：Mac16,10 / Apple M4 / 32 GiB，macOS 15.6.1（24G90）。只记录设备类型，不读取序列号。阶段 1 的副本迁移/恢复时间不替代查询 p95 或三端性能门槛。
- 查询计时定义：用户激活表达到中文解释首次可见；缓存命中记录 p95，至少 100 次，固定设备与构建版本。匹配定义：文本准备完成到标记可点击，10,000 条保存，报告实测设备/数据量。尚未测得的数字不宣称达标。
- UI 默认 ocean / midnight 的默认、hover、selected、disabled、focus；360/390/430/768/1024/1280/1440 宽。浏览器 fixture 只证明界面逻辑；Rust/SQLite、文件系统、语音、云端冲突和三端设备分别验收。
