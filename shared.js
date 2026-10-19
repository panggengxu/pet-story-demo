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

  // 首次打开时创建演示账号
  const ready = (async () => {
    if (users().length) return;
    const mk = async (id, name, role, pw) => ({ id, name, role, pw: await hash(id, pw) });
    saveUsers([
      await mk('teacher', '老师', 'teacher', 'teacher123'),
      await mk('s001', '小明', 'student', '1234'),
      await mk('s002', '小华', 'student', '1234')
    ]);
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
  // 提交记录统一成 {status:'pending'|'done'|'rejected', note, photo, time, reply}（兼容旧版字符串）
  const sub = (n, id) => { const v = n.subs[id]; return typeof v === 'string' ? { status: v } : (v || null); };
  // 证明照片单独存放，避免公告数据过大；容量不足时 setProof 会抛错
  const PK = (nid, sid) => 'petsStory.proof.' + nid + '.' + sid;
  const getProof = (nid, sid) => localStorage.getItem(PK(nid, sid));
  const setProof = (nid, sid, url) => localStorage.setItem(PK(nid, sid), url);
  const delProof = (nid, sid) => localStorage.removeItem(PK(nid, sid));

  return { SUBJECTS, KIND, sub, getProof, setProof, delProof, NK, notices, saveNotices, START, hash, users, saveUsers, ready, session, login, logout, guard, saveKey, loadSave, writeSave };
})();
