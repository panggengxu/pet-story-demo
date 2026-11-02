# Pets Story（补习中心学习宠物游戏）

学生通过签到、做功课、默写获得金币和经验，养成宠物、抽装备和文具盲盒、和好友对战交易；老师用后台管理班级、名单、公告功课和奖励。

## 一、文件说明
| 文件 | 作用 |
|---|---|
| `login.html` | 登录页（学生 / 老师） |
| `index.html` | 学生页：签到状态、宠物、背包、技能对战、好友、交易、留言墙、封神榜、文具商店 |
| `teacher.html` | 老师 / 管理员后台：班级与账号、名单、公告功课、成绩、升班、留言管理 |
| `stationery.html` | 文具后台：库存与上架、待发货订单、缺货退款 |
| `shared.js` | 所有页面共用的 `Auth` 模块（登录、读取并缓存数据、写入 Supabase） |
| `admin-users.ts` | Supabase Edge Function（创建 / 改名 / 重置密码 / 删除账号，需要 secret key，只能放服务器端） |
| `schema*.sql` | 数据库脚本，见下面“数据库” |
| `HANDOVER.md` | 开发约定和踩过的坑（接手的人先读这个） |

技术：纯静态网页（Vercel 托管）+ Supabase（登录、Postgres、Edge Function、照片存储）。没有自己的服务器。

## 二、首次部署
1. **Supabase**：新建项目（地区选新加坡）。Authentication 里**关闭公开注册**（Allow new users to sign up）。
2. **数据库**：在 SQL Editor 按顺序运行 `schema*.sql`（见下）。每个脚本只运行一次；弹出“Potential issue detected”时，点 *Run and enable RLS* 或 *Run query*。
3. **创建第一个管理员**：Authentication → Users → Add user，邮箱 `teacher@pets.test`，设密码，勾选 Auto Confirm User；再运行 `schema.sql` 末尾“第二部分”的两句 SQL。
4. **Edge Function**：Edge Functions → Deploy a new function → Via Editor，函数名 `admin-users`，粘贴 `admin-users.ts`。缺少密钥时，在 Secrets 里添加 `ADMIN_SECRET_KEY`（值是 secret key，**绝不能写进网页**）。
5. **网页**：把所有 `.html` 和 `shared.js` 放到 GitHub 仓库，Vercel 导入后自动部署。`shared.js` 里的 Project URL 和 publishable key 是公开的，可以放在网页里。
6. 用 `teacher` 账号登录 `login.html`（身份选“老师”），先建班级，再添加学生。

## 三、数据库
按下面的顺序运行（以你们数据库实际运行过的为准）：
`schema.sql` → `schema2.sql` → `schema3.sql` → `schema4.sql` → `schema6.sql` → `schema7.sql` → `schema8.sql` → `schema9.sql` → `schema11.sql` → `schema12.sql` → `schema13.sql` → `schema14.sql` → `schema15.sql` → `schema16.sql`

说明：
- `schema5.sql`（姓名缩写）已被 `schema6.sql` 撤销；`schema10.sql` 的异步对战已被实时对战（`schema12` 之后）取代。
- **下面这些功能的建表 SQL 不在项目文件里**（是后来由别的 AI 在数据库里直接创建的）：宠物交易 `pet_trades`、文具 `stationery_stock` / `stationery_orders`、排行榜函数 `get_leaderboard`、`duels` 表的血量字段（`a_hp`、`b_hp`）。**请现在就导出保存**，否则以后换数据库或重建环境时会缺东西：
  ```sql
  -- 所有函数的完整代码
  select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
  -- 所有访问规则（RLS）
  select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename;
  ```
  或者用 Supabase CLI：`supabase db dump -f backup.sql`。

## 四、账号与学号规则
- 登录用学号（自动转成 `学号@pets.test` 的内部邮箱）。学号格式 `p + 入学年份后两位 + 3 位序号`，如 `p26001`（2026 年入读一年级的第 1 位），读到六年级毕业都不用改，系统自动算年级。
- 密码至少 6 位。学号以 `test` 开头的学生账号，首页下方有测试工具（重置存档、补满宠物、加金币等），建议放在单独的“测试班”里。
- 新学年：老师后台“一键升班”，六年级升到“已毕业”班。

## 五、日常运营
- **签到**：只有老师能签（“默写 / 功课名单”里类型选“签到”），每签一科学生自动得金币和经验。
- **文具**：学生买到 / 抽到后，在 `stationery.html` 的“待发货订单”里标记发放；缺货点“缺货退款”。
- **照片证明**：老师批准功课后，照片自动删除，节省空间。
- **免费版注意**：Supabase 免费项目一周没有活动会被暂停（放假前后请登录控制台检查，数据不会丢）；数据库 500MB、文件存储 1GB。

## 六、安全与已知限制（上线前请读）
1. **游戏数据（金币、背包、宠物、战力）存在学生浏览器里**，懂技术的学生可以修改。奖励和礼物通过数据库的“奖励记录”发放，并有每日上限，但金币余额本身没有服务器校验。
2. **文具是实物**：学生直购 / 盲盒时，库存和订单由学生的浏览器直接写入数据库，金币扣款在浏览器里完成。所以：
   - 老师发放文具时请核对订单，必要时抽查；
   - 建议尽快把“购买”改成数据库函数（库存检查、订单、每日限购在一个事务里完成），并收紧 `stationery_stock` / `stationery_orders` 的访问规则，不让学生直接改库存和价格。做这个需要先导出上面的 SQL 和访问规则。
3. 学生看不到别人的资料：好友、排行、对战、留言、封神榜等凡是涉及“别人的数据”的，都通过数据库函数（`security definer`）返回。新功能请沿用这个办法。
4. 留言墙没有关键字过滤，靠老师在“留言墙管理”里删除；学生每小时最多发 10 条，留言保留 30 天。
5. 页面里的 `claimTeacherDaily`（教师津贴）按钮是隐藏的，目前没有对应功能，别误以为它能用。

## 七、常用修改位置
- 宠物品种、形态、稀有度：`index.html` 里的 `PET_TYPES`。
- 宠物技能：Supabase 的 `pet_skills` 表（直接改表，不用改代码）；对战伤害比例是 `duel_action` 函数里的 `dmg_rate`。
- 签到奖励：`shared.js` 里的 `CHECKIN_REWARD`。
- 抽奖奖池和概率：`index.html` 里的 `POOL`。

## 八、出问题时
1. 电脑浏览器按 F12 → Console，看红色报错；很多“点了没反应”是某个功能没定义，或学生读不到别人的数据被静默吞掉。
2. 改完代码先运行 `node --check`（语法）；检查页面里每个 `data-action` 都能在 `ACTIONS` 里找到。
3. 一次只让一个人（或一个 AI）改同一份文件，部署测试通过再换下一个；改数据库前先备份。
