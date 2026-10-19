// 登录与账号模块：login.html / teacher.html / index.html 共用
// 注意：数据都存在浏览器 localStorage 里，适合课堂演示，不是真正的安全系统。
const Auth = (() => {
  const UK = 'petsStory.users.v1', SK = 'petsStory.session';
  const START = { coins: 500, stars: 10 };                 // 学生初始金币/星星（与 index.html 一致）
  const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = (id, pw) => sha(id + ':' + pw);              // 用账号做盐，密码不明文保存
  const users = () => { try { return JSON.parse(localStorage.getItem(UK)) || []; } catch { return []; } };
  const saveUsers = u => localStorage.setItem(UK, JSON.stringify(u));

  // 班级：[{id,name}]。学生有 classId；老师有 classIds（负责的班级）；admin:true 的老师可管理所有班级和老师账号
  const CK = 'petsStory.classes.v1';
  const classes = () => { try { return JSON.parse(localStorage.getItem(CK)) || []; } catch { return []; } };
  const saveClasses = c => localStorage.setItem(CK, JSON.stringify(c));

  // 首次打开时创建演示账号；旧数据（没有班级）自动迁移到“示范班”
  const ready = (async () => {
    await 0;                                     // 等下面的函数都定义完再执行
    if (!users().length) {
      const mk = async (id, name, role, pw) => ({ id, name, role, pw: await hash(id, pw) });
      saveUsers([
        await mk('teacher', '老师', 'teacher', 'teacher123'),
        await mk('s001', '小明', 'student', '1234'),
        await mk('s002', '小华', 'student', '1234')
      ]);
    }
    let cs = classes(), us = users(), changed = false;
    if (!cs.length && us.some(x => x.role === 'student' && !x.classId)) { cs = [{ id: 'c1', name: '示范班' }]; saveClasses(cs); }
    if (!us.some(x => x.admin)) { const t = us.find(x => x.role === 'teacher'); if (t) { t.admin = true; changed = true; } }
    us.forEach(x => {
      if (x.role === 'student' && !x.classId) { x.classId = cs[0].id; changed = true; }
      if (x.role === 'teacher' && !x.classIds) { x.classIds = cs.map(c => c.id); changed = true; }
    });
    if (changed) saveUsers(us);
    const first = cs[0]?.id;                     // 旧的主题/公告（没有班级）归入第一个班，避免出现在所有班级里
    if (first) {
      const ts = topics(), ns = notices();
      if (ts.some(t => !t.classId)) { ts.forEach(t => { t.classId ||= first; }); saveTopics(ts); }
      if (ns.some(n => !n.classId)) { ns.forEach(n => { n.classId ||= first; }); saveNotices(ns); }
    }
  })();

  const session = () => { try { return JSON.parse(sessionStorage.getItem(SK)); } catch { return null; } };
  async function login(id, pw, role) {
    await ready;
    const u = users().find(x => x.id === id.trim());
    if (!u || u.role !== role || u.pw !== await hash(u.id, pw)) return null;
    sessionStorage.setItem(SK, JSON.stringify({ id: u.id, name: u.name, role: u.role })); // 关闭浏览器即退出
    return u;
  }
  const logout = () => { sessionStorage.removeItem(SK); location.href = 'login.html'; };
  const guard = role => {                                   // 页面入口检查：身份不对就回登录页
    const s = session();
    if (!s || s.role !== role) { location.replace('login.html'); return null; }
    return s;
  };
  const saveKey = id => 'petsStory.save.' + id;             // 每个学生独立存档
  const loadSave = id => { try { return JSON.parse(localStorage.getItem(saveKey(id))); } catch { return null; } };
  const writeSave = (id, o) => localStorage.setItem(saveKey(id), JSON.stringify(o));

  // 公告与任务：{id,type:'notice'|'task',title,body,coins,stars,date,subs:{学号:'pending'|'done'}}
  const NK = 'petsStory.notices.v1';
  const notices = () => { try { return JSON.parse(localStorage.getItem(NK)) || []; } catch { return []; } };
  const saveNotices = n => localStorage.setItem(NK, JSON.stringify(n));
  const SUBJECTS = ['BC 华文', 'BM 马来文', 'BI 英文', 'MM 数学', 'SC 科学'];
  const KIND = { notice: '📢 公告', task: '🎯 任务', homework: '📚 功课' };
  // 默写/功课名单（老师手动勾选，适用于补习中心等线下完成的情况）
  // 格式：{ '2026-10-19|默写|BC 华文': ['s001', 's002'] }，数组里是“已完成”的学号
  const RK = 'petsStory.records.v1';
  const records = () => { try { return JSON.parse(localStorage.getItem(RK)) || {}; } catch { return {}; } };
  const saveRecords = r => localStorage.setItem(RK, JSON.stringify(r));
  // 主题名单（作文、专题等不按日期的项目）：[{id,kind,subject,title,due,done:['s001',...]}]
  const TK = 'petsStory.topics.v1';
  const topics = () => { try { return JSON.parse(localStorage.getItem(TK)) || []; } catch { return []; } };
  const saveTopics = t => localStorage.setItem(TK, JSON.stringify(t));
  // 提交记录统一成 {status:'pending'|'done'|'rejected', note, photo, time, reply}（兼容旧版字符串）
  const sub = (n, id) => { const v = n.subs[id]; return typeof v === 'string' ? { status: v } : (v || null); };
  // 证明照片单独存放，避免公告数据过大；容量不足时 setProof 会抛错
  const PK = (nid, sid) => 'petsStory.proof.' + nid + '.' + sid;
  const getProof = (nid, sid) => localStorage.getItem(PK(nid, sid));
  const setProof = (nid, sid, url) => localStorage.setItem(PK(nid, sid), url);
  const delProof = (nid, sid) => localStorage.removeItem(PK(nid, sid));

  return { classes, saveClasses, topics, saveTopics, records, saveRecords, SUBJECTS, KIND, sub, getProof, setProof, delProof, NK, notices, saveNotices, START, hash, users, saveUsers, ready, session, login, logout, guard, saveKey, loadSave, writeSave };
})();
