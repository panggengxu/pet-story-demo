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

  // ---- 缓存：登录后从 Supabase 读来，页面代码仍然可以同步读取 ----
  const SUBJECTS = ['BC 华文', 'BM 马来文', 'BI 英文', 'MM 数学', 'SC 科学'];
  const KIND = { notice: '📢 公告', task: '🎯 任务', homework: '📚 功课' };
  const clone = x => JSON.parse(JSON.stringify(x));
  const ck = r => { if (r && r.error) throw new Error(r.error.message); return r; };
  let U = [], C = [], N = [], T = [], RC = {}, SV = {}, PA = {};
  const LD = new Set([new Date().toLocaleDateString('sv')]);          // 已载入名单的日期
  const PH = {};                                                      // 等待上传的证明照片（dataURL）
  const uidOf = code => U.find(u => u.id === code)?.uid;
  const codeOf = uid => U.find(u => u.uid === uid)?.id;
  const users = () => U;
  const classes = () => C;

  async function refresh() {
    const rs = await Promise.all([
      sb.from('profiles').select('user_id,code,name,role,is_admin,class_id'),
      sb.from('classes').select('id,name').order('created_at'),
      sb.from('teacher_classes').select('teacher_id,class_id'),
      sb.from('notices').select('*').order('created_at', { ascending: false }),
      sb.from('submissions').select('*'),
      sb.from('topics').select('*').order('created_at'),
      sb.from('topic_done').select('topic_id,student_id'),
      sb.from('records').select('day,kind,subject,student_id').in('day', [...LD]),
      sb.from('game_saves').select('user_id,data'),
      sb.from('awards').select('student_id,coins,stars').eq('claimed', false)
    ]);
    rs.forEach(ck);
    const [p, c, tc, n, s, t, td, r, g, a] = rs.map(x => x.data);
    const tcm = {};
    tc.forEach(x => (tcm[x.teacher_id] ||= []).push(x.class_id));
    U = p.map(x => ({ uid: x.user_id, id: x.code, name: x.name, role: x.role, admin: x.is_admin, classId: x.class_id, classIds: tcm[x.user_id] || [] }));
    C = c;
    N = n.map(x => ({ id: x.id, classId: x.class_id, batch: x.batch, important: x.important, type: x.type, subject: x.subject, title: x.title,
      body: x.body, coins: x.coins, stars: x.stars, needProof: x.need_proof, date: x.created_at.slice(0, 10), subs: {} }));
    s.forEach(x => {
      const nn = N.find(y => y.id === x.notice_id), cd = codeOf(x.student_id);
      if (nn && cd) nn.subs[cd] = { status: x.status, note: x.note, photo: !!x.photo_path, time: Date.parse(x.submitted_at), reply: x.reply };
    });
    T = t.map(x => ({ id: x.id, classId: x.class_id, kind: x.kind, subject: x.subject, title: x.title, due: x.due || '', done: [] }));
    td.forEach(x => { const tt = T.find(y => y.id === x.topic_id), cd = codeOf(x.student_id); if (tt && cd) tt.done.push(cd); });
    RC = {};
    r.forEach(x => { const cd = codeOf(x.student_id); if (cd) (RC[`${x.day}|${x.kind}|${x.subject}`] ||= []).push(cd); });
    SV = {};
    g.forEach(x => { const cd = codeOf(x.user_id); if (cd) SV[cd] = x.data; });
    PA = {};
    a.forEach(x => { const cd = codeOf(x.student_id); if (cd) { const o = PA[cd] ||= { coins: 0, stars: 0 }; o.coins += x.coins; o.stars += x.stars; } });
  }
  const loadDay = async day => { LD.add(day); await refresh(); };

  // ---- 写入：页面代码修改缓存的副本再调用 saveXxx，这里对比差异后同步到 Supabase ----
  let Q = Promise.resolve(), pend = 0;
  function run(ops) {
    if (!ops.length) return;
    pend++;
    Q = Q.then(async () => { for (const f of ops) await f(); })
      .catch(e => { console.error(e); alert('保存失败：' + e.message + '\n页面将重新载入最新数据'); location.reload(); })
      .finally(() => { pend--; });
  }
  const busy = () => pend > 0;

  async function pushSub(nid, code, s, exists) {
    const uid = uidOf(code), key = nid + '|' + code, path = `${uid}/${nid}.jpg`;
    if (PH[key]) {
      const blob = await (await fetch(PH[key])).blob();
      ck(await sb.storage.from('proofs').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }));
      delete PH[key];
    }
    const row = { status: s.status, note: s.note || '', photo_path: s.photo && s.status !== 'done' ? path : null, reply: s.reply || '', submitted_at: new Date(s.time || Date.now()).toISOString() };
    ck(exists
      ? await sb.from('submissions').update(row).eq('notice_id', nid).eq('student_id', uid)
      : await sb.from('submissions').insert({ notice_id: nid, student_id: uid, ...row }));
    // 老师批准后，证明照片已经没有用处（页面不会再显示），删除它来节省存储空间
    if (s.status === 'done' && s.photo) await sb.storage.from('proofs').remove([path]);
  }
  function diffNotices(prev, next) {
    const ops = [], pm = new Map(prev.map(n => [n.id, n])), nm = new Map(next.map(n => [n.id, n]));
    for (const n of prev) if (!nm.has(n.id)) ops.push(async () => {
      const paths = Object.entries(n.subs).filter(([, s]) => s.photo).map(([c]) => `${uidOf(c)}/${n.id}.jpg`);
      if (paths.length) await sb.storage.from('proofs').remove(paths);
      ck(await sb.from('notices').delete().eq('id', n.id));
    });
    for (const n of next) {
      const old = pm.get(n.id);
      if (!old) ops.push(async () => ck(await sb.from('notices').insert({ id: n.id, class_id: n.classId, batch: n.batch || null, important: !!n.important,
        type: n.type, subject: n.subject || '', title: n.title, body: n.body || '', coins: n.coins || 0, stars: n.stars || 0, need_proof: !!n.needProof })));
      else {
        for (const [c, s] of Object.entries(n.subs)) if (JSON.stringify(s) !== JSON.stringify(old.subs[c])) ops.push(() => pushSub(n.id, c, s, !!old.subs[c]));
        for (const c of Object.keys(old.subs)) if (!n.subs[c]) ops.push(async () => ck(await sb.from('submissions').delete().eq('notice_id', n.id).eq('student_id', uidOf(c))));
      }
    }
    return ops;
  }
  function diffTopics(prev, next) {
    const ops = [], pm = new Map(prev.map(t => [t.id, t])), nm = new Map(next.map(t => [t.id, t]));
    for (const t of prev) if (!nm.has(t.id)) ops.push(async () => ck(await sb.from('topics').delete().eq('id', t.id)));
    for (const t of next) {
      const old = pm.get(t.id);
      if (!old) ops.push(async () => ck(await sb.from('topics').insert({ id: t.id, class_id: t.classId, kind: t.kind, subject: t.subject, title: t.title, due: t.due || null })));
      const a = old ? old.done : [], add = t.done.filter(c => !a.includes(c)), del = a.filter(c => !t.done.includes(c));
      if (add.length) ops.push(async () => ck(await sb.from('topic_done').upsert(add.map(c => ({ topic_id: t.id, student_id: uidOf(c) })), { onConflict: 'topic_id,student_id', ignoreDuplicates: true })));
      if (del.length) ops.push(async () => ck(await sb.from('topic_done').delete().eq('topic_id', t.id).in('student_id', del.map(uidOf))));
    }
    return ops;
  }
  function diffRecords(prev, next) {
    const ops = [];
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      const [day, kind, subject] = key.split('|'), a = prev[key] || [], b = next[key] || [];
      const add = b.filter(c => !a.includes(c)), del = a.filter(c => !b.includes(c));
      if (add.length) ops.push(async () => ck(await sb.from('records').upsert(add.map(c => ({ day, kind, subject, student_id: uidOf(c) })), { onConflict: 'day,kind,subject,student_id', ignoreDuplicates: true })));
      if (del.length) ops.push(async () => ck(await sb.from('records').delete().eq('day', day).eq('kind', kind).eq('subject', subject).in('student_id', del.map(uidOf))));
    }
    return ops;
  }
  const notices = () => clone(N), topics = () => clone(T), records = () => clone(RC);
  const saveNotices = next => { const ops = diffNotices(N, next); N = clone(next); run(ops); };
  const saveTopics = next => { const ops = diffTopics(T, next); T = clone(next); run(ops); };
  const saveRecords = next => { const ops = diffRecords(RC, next); RC = clone(next); run(ops); };
  // 提交记录统一成 {status:'pending'|'done'|'rejected', note, photo, time, reply}
  const sub = (n, id) => { const v = n.subs[id]; return typeof v === 'string' ? { status: v } : (v || null); };

  // ---- 证明照片（存在私有存储桶 proofs；老师查看时生成 1 小时有效的临时链接） ----
  const setProof = (nid, code, dataUrl) => { PH[nid + '|' + code] = dataUrl; };
  const delProof = (nid, code) => { delete PH[nid + '|' + code]; };
  async function proofUrl(nid, code) {
    const { data, error } = await sb.storage.from('proofs').createSignedUrl(`${uidOf(code)}/${nid}.jpg`, 3600);
    return error ? null : data.signedUrl;
  }

  // ---- 奖励：老师发放 → 学生领取 ----
  function grant(code, coins, stars, note) {
    if (!coins && !stars) return;
    const o = PA[code] ||= { coins: 0, stars: 0 };
    o.coins += coins; o.stars += stars;
    run([async () => ck(await sb.from('awards').insert({ student_id: uidOf(code), coins, stars, note: note || '' }))]);
  }
  async function claimAwards() {
    const { data, error } = await sb.from('awards').update({ claimed: true }).eq('claimed', false).select('coins,stars,note');
    if (error) throw new Error(error.message);
    return data || [];
  }
  const pendingAward = code => PA[code] || null;

  // ---- 游戏存档：学生读写自己的；老师读自己班学生的 ----
  const loadSave = code => SV[code] ? clone(SV[code]) : null;
  async function fetchMySave() {
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('game_saves').select('data').eq('user_id', user.id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.data : null;
  }
  let pushTimer;
  function pushMySave(obj, now) {
    clearTimeout(pushTimer);
    const go = async () => {
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (session) ck(await sb.from('game_saves').upsert({ user_id: session.user.id, data: obj, updated_at: new Date().toISOString() }));
      } catch (e) { console.warn('存档同步失败', e.message); }
    };
    if (now) go(); else pushTimer = setTimeout(go, 1500);
  }
  const saveKey = id => 'petsStory.save.' + id;                       // 本机备份用

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

  return { sb, refresh, loadDay, busy, call, addClass, delClass, moveStudent, setTeacherClass, changeMyPassword,
    users, classes, ready, session, login, logout, guard, START, SUBJECTS, KIND, saveKey,
    notices, saveNotices, topics, saveTopics, records, saveRecords, sub, setProof, delProof, proofUrl,
    grant, claimAwards, pendingAward, loadSave, fetchMySave, pushMySave };
})();
