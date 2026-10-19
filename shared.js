// 账号与班级模块（Supabase 版）。需要先加载 supabase-js：
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.1/dist/umd/supabase.js"></script>
// 阶段一：登录、账号、班级、老师负责的班级 → 存在 Supabase。
// 公告/功课/名单/游戏存档 → 暂时仍存在浏览器里（后续阶段再迁移）。
const Auth = (() => {
  const SB_URL = 'https://fslirdwjwewfckdyzzrr.supabase.co';
  const SB_KEY = 'sb_publishable_BGl41HJnvDH8K-rUbQqWmQ_XsHGBxrK';   // 公开的 publishable key，可以放在网页里
  const DOMAIN = 'pets.test';                                         // 学号 → 假邮箱的后缀，要和 Edge Function 一致
  const SK = 'petsStory.session';
  const START = { coins: 500, stars: 10 };                            // 学生初始金币/星星（与 index.html 一致）
  const sb = supabase.createClient(SB_URL, SB_KEY);
  const email = code => `${String(code).trim().toLowerCase()}@${DOMAIN}`;

  // ---- 缓存：登录后从 Supabase 读来的用户和班级（保持原来同步读取的用法） ----
  let U = [], C = [];
  const users = () => U;
  const classes = () => C;
  async function refresh() {
    const [p, c, t] = await Promise.all([
      sb.from('profiles').select('user_id,code,name,role,is_admin,class_id'),
      sb.from('classes').select('id,name').order('created_at'),
      sb.from('teacher_classes').select('teacher_id,class_id')
    ]);
    const err = p.error || c.error || t.error;
    if (err) throw new Error(err.message);
    const tc = {};
    t.data.forEach(r => (tc[r.teacher_id] ||= []).push(r.class_id));
    U = p.data.map(r => ({ uid: r.user_id, id: r.code, name: r.name, role: r.role, admin: r.is_admin, classId: r.class_id, classIds: tc[r.user_id] || [] }));
    C = c.data;
  }

  // ---- 会话 ----
  const session = () => { try { return JSON.parse(sessionStorage.getItem(SK)); } catch { return null; } };
  const setSession = u => sessionStorage.setItem(SK, JSON.stringify({ id: u.id, name: u.name, role: u.role }));
  const ready = (async () => {                                        // 每个页面加载时：确认已登录并载入资料
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        sessionStorage.removeItem(SK);
        if (!/login\.html$/.test(location.pathname)) location.replace('login.html');
        return;
      }
      await refresh();
      const me = U.find(x => x.uid === data.session.user.id);
      if (me) setSession(me);
    } catch (e) { alert('连接服务器失败：' + e.message); throw e; }
  })();
  async function login(id, pw, role) {
    const { error } = await sb.auth.signInWithPassword({ email: email(id), password: pw });
    if (error) return null;
    await refresh();
    const { data: { user } } = await sb.auth.getUser();
    const u = U.find(x => x.uid === user.id);
    if (!u || u.role !== role) { await sb.auth.signOut(); return null; }
    setSession(u); return u;
  }
  const logout = () => sb.auth.signOut().finally(() => { sessionStorage.removeItem(SK); location.href = 'login.html'; });
  const guard = role => {                                             // 页面入口检查：身份不对就回登录页
    const s = session();
    if (!s || s.role !== role) { location.replace('login.html'); return null; }
    return s;
  };

  // ---- 班级 / 账号管理（权限由数据库的 RLS 和 Edge Function 把关） ----
  const wrap = async p => {
    const { error } = await p;
    if (error) throw new Error(error.code === '23505' ? '名称或账号已存在' : error.message);
    await refresh();
  };
  const addClass = name => wrap(sb.from('classes').insert({ name }));
  const delClass = id => wrap(sb.from('classes').delete().eq('id', id));
  const moveStudent = (uid, classId) => wrap(sb.from('profiles').update({ class_id: classId }).eq('user_id', uid));
  const setTeacherClass = (uid, classId, on) => wrap(on
    ? sb.from('teacher_classes').insert({ teacher_id: uid, class_id: classId })
    : sb.from('teacher_classes').delete().eq('teacher_id', uid).eq('class_id', classId));
  async function changeMyPassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }
  // 调用 Edge Function：createStudent / createTeacher / resetPassword / deleteUser
  async function call(action, payload) {
    const { data, error } = await sb.functions.invoke('admin-users', { body: { action, ...payload } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    await refresh();
    return data;
  }

  // ---- 每个学生的游戏存档（阶段二再迁移到 Supabase） ----
  const saveKey = id => 'petsStory.save.' + id;
  const loadSave = id => { try { return JSON.parse(localStorage.getItem(saveKey(id))); } catch { return null; } };
  const writeSave = (id, o) => localStorage.setItem(saveKey(id), JSON.stringify(o));

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

  return { sb, refresh, call, addClass, delClass, moveStudent, setTeacherClass, changeMyPassword,
    users, classes, ready, session, login, logout, guard, START, saveKey, loadSave, writeSave,
    topics, saveTopics, records, saveRecords, SUBJECTS, KIND, sub, getProof, setProof, delProof, NK, notices, saveNotices };
})();
