import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Boxes, CircuitBoard, ExternalLink, ImagePlus, LogOut, MapPin, Minus, PackagePlus, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Toaster, toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adjustQuantity, clearConfig, createPart, deletePart, getConfig, listParts, makeClient, removeImage as removePartImage, saveConfig, updatePart, uploadImage, type Config, type Draft, type Part } from "./data";

type BrowserTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> };
type BrowserModelContext = { registerTool: (tool: BrowserTool, options: { signal: AbortSignal }) => void | Promise<void> };
const blank: Draft = { name: "", model: "", category: "", tags: [], quantity: 0, location: "", specifications: "", supplier: "", datasheetUrl: "" };

export default function App() {
  const [config, setConfig] = useState<Config>(getConfig);
  const [setupUrl, setSetupUrl] = useState(config.url);
  const [setupKey, setSetupKey] = useState(config.key);
  const client = useMemo(() => config.url && config.key ? makeClient(config) : null, [config]);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(!!client);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signUpMode, setSignUpMode] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState("all");
  const [tag, setTag] = useState("all");
  const [editing, setEditing] = useState<Part | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [tagText, setTagText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Part | null>(null);

  useEffect(() => {
    if (!client) { setAuthLoading(false); return; }
    let active = true;
    setAuthLoading(true);
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      if (!next) setParts([]);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    try {
      setParts(await listParts(client));
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "読み込めませんでした。");
    } finally { setLoading(false); }
  }, [client, session]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!client || !session) return;
    const context = (document as Document & { modelContext?: BrowserModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: BrowserTool) => {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(console.error); }
      catch (error) { console.error(error); }
    };
    register({
      name: "search_parts", title: "部品を検索", description: "部品の名前・型番・タグ・保管場所を検索し、一覧の検索語も更新します。",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const query = (input as { query?: unknown })?.query;
        if (typeof query !== "string") throw new Error("検索語を指定してください。");
        setQuery(query);
        const needle = query.trim().toLocaleLowerCase();
        return { parts: parts.filter(p => [p.name, p.model, p.category, p.location, ...p.tags].join(" ").toLocaleLowerCase().includes(needle)).map(p => ({ id: p.id, name: p.name, model: p.model, quantity: p.quantity })) };
      },
    });
    register({
      name: "adjust_part_quantity", title: "部品の在庫を1個変更", description: "指定した部品の数量を1個増やすか減らし、一覧を更新します。",
      inputSchema: { type: "object", properties: { partId: { type: "string", format: "uuid" }, delta: { type: "integer", enum: [-1, 1] } }, required: ["partId", "delta"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const values = input as { partId?: unknown; delta?: unknown };
        if (typeof values?.partId !== "string" || !/^[0-9a-f-]{36}$/i.test(values.partId) || values.delta !== 1 && values.delta !== -1) throw new Error("部品IDと変更量を確認してください。");
        const part = await adjustQuantity(client, values.partId, values.delta);
        setParts(current => current.map(p => p.id === values.partId ? part : p));
        return { id: part.id, quantity: part.quantity };
      },
    });
    return () => lifecycle.abort();
  }, [client, session, parts]);

  const categories = useMemo(() => [...new Set(parts.map(p => p.category).filter(Boolean))].sort((a,b) => a.localeCompare(b, "ja")), [parts]);
  const tags = useMemo(() => [...new Set(parts.flatMap(p => p.tags))].sort((a,b) => a.localeCompare(b, "ja")), [parts]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return parts.filter(p => {
      const searchable = [p.name, p.model, p.category, p.location, p.specifications, p.supplier, ...p.tags].join(" ").toLocaleLowerCase();
      return (!needle || searchable.includes(needle)) && (category === "all" || p.category === category) &&
        (tag === "all" || p.tags.includes(tag)) && (stock === "all" || stock === "zero" && p.quantity === 0 || stock === "low" && p.quantity > 0 && p.quantity <= 5);
    });
  }, [parts, query, category, stock, tag]);
  const totalQuantity = parts.reduce((sum, p) => sum + p.quantity, 0);
  const lowCount = parts.filter(p => p.quantity <= 5).length;
  const hasFilter = !!query || category !== "all" || stock !== "all" || tag !== "all";

  function openCreate() {
    setEditing(null); setDraft(blank); setTagText(""); setImageFile(null); setRemoveImage(false); setFormOpen(true);
  }
  function openEdit(part: Part) {
    setEditing(part); setDraft({ name: part.name, model: part.model, category: part.category, tags: part.tags, quantity: part.quantity, location: part.location, specifications: part.specifications, supplier: part.supplier, datasheetUrl: part.datasheetUrl });
    setTagText(part.tags.join(", ")); setImageFile(null); setRemoveImage(false); setFormOpen(true);
  }
  function setField<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => ({ ...current, [key]: value })); }

  function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setConfig(saveConfig({ url: setupUrl, key: setupKey }));
      setAuthError("");
      setAuthLoading(true);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "設定を確認してください。");
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setAuthBusy(true);
    setAuthError("");
    setAuthMessage("");
    try {
      const { data, error } = signUpMode
        ? await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } })
        : await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword("");
      if (signUpMode && !data.session) setAuthMessage("確認メールのリンクを開いてからログインしてください。");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "ログインできませんでした。");
    } finally { setAuthBusy(false); }
  }

  async function save() {
    if (!client || !session) return;
    if (!draft.name.trim()) { toast.error("部品名を入力してください。"); return; }
    if (!Number.isSafeInteger(draft.quantity) || draft.quantity < 0) { toast.error("数量は0以上の整数にしてください。"); return; }
    if (imageFile && (imageFile.size > 5_000_000 || imageFile.size === 0 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageFile.type))) { toast.error("画像はJPEG・PNG・WebP・GIF形式、5MB以下にしてください。"); return; }
    setSaving(true);
    try {
      const payload = { ...draft, tags: tagText.split(/[、,]/).map(t => t.trim()).filter(Boolean) };
      let part = editing ? await updatePart(client, editing.id, payload) : await createPart(client, payload);
      if (!editing) setEditing(part);
      if (removeImage && editing?.imagePath) part = await removePartImage(client, part);
      if (imageFile) part = await uploadImage(client, session.user.id, part, imageFile);
      await load();
      setFormOpen(false);
      toast.success(editing ? "部品を更新しました。" : "部品を追加しました。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存できませんでした。");
      await load();
    } finally { setSaving(false); }
  }

  async function adjust(part: Part, delta: 1 | -1) {
    if (!client) return;
    if (busyId !== null || delta === -1 && part.quantity === 0) return;
    setBusyId(part.id);
    try {
      const updated = await adjustQuantity(client, part.id, delta);
      setParts(current => current.map(p => p.id === part.id ? updated : p));
    } catch (error) { toast.error(error instanceof Error ? error.message : "数量を変更できませんでした。"); }
    finally { setBusyId(null); }
  }

  async function remove() {
    if (!deleteTarget || !client) return;
    const target = deleteTarget;
    try {
      await deletePart(client, target);
      setParts(current => current.filter(p => p.id !== target.id));
      setDeleteTarget(null);
      setFormOpen(false);
      toast.success("部品を削除しました。");
    } catch (error) { toast.error(error instanceof Error ? error.message : "削除できませんでした。"); }
  }

  if (!client) return (
    <main className="auth-shell">
      <Toaster position="bottom-right" richColors />
      <section className="auth-card">
        <div className="auth-brand"><span className="brand-mark"><CircuitBoard size={21} /></span><strong>PartBase</strong></div>
        <div className="eyebrow">FIRST SETUP</div>
        <h1>保存先を設定</h1>
        <p>Supabase の Project URL と publishable key を入力します。設定はこの端末に保存されます。</p>
        <form className="auth-form" onSubmit={configure}>
          <label className="field"><span>Project URL</span><Input type="url" required placeholder="https://xxxxx.supabase.co" value={setupUrl} onChange={e => setSetupUrl(e.target.value)} /></label>
          <label className="field"><span>Publishable key</span><Input type="text" required placeholder="sb_publishable_..." value={setupKey} onChange={e => setSetupKey(e.target.value)} /></label>
          {authError && <p className="auth-error" role="alert">{authError}</p>}
          <Button type="submit" size="lg">保存して続ける</Button>
        </form>
        <p className="auth-note"><a href="https://supabase.com/dashboard/projects" target="_blank" rel="noopener noreferrer">Supabase でプロジェクトを作成</a>して、リポジトリの README にある SQL を実行してください。secret key は入力しないでください。</p>
      </section>
    </main>
  );

  if (authLoading) return <main className="auth-shell"><div className="auth-card"><div className="auth-brand"><span className="brand-mark"><CircuitBoard size={21} /></span><strong>PartBase</strong></div><p>接続を確認しています...</p></div></main>;

  if (!session) return (
    <main className="auth-shell">
      <Toaster position="bottom-right" richColors />
      <section className="auth-card">
        <div className="auth-brand"><span className="brand-mark"><CircuitBoard size={21} /></span><strong>PartBase</strong></div>
        <div className="eyebrow">INVENTORY</div>
        <h1>{signUpMode ? "アカウントを作成" : "在庫にログイン"}</h1>
        <p>{signUpMode ? "メールアドレスとパスワードを登録します。確認メールが届く場合があります。" : "登録したメールアドレスとパスワードを入力してください。"}</p>
        <form className="auth-form" onSubmit={event => void signIn(event)}>
          <label className="field"><span>メールアドレス</span><Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="field"><span>パスワード</span><Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
          {authError && <p className="auth-error" role="alert">{authError}</p>}
          {authMessage && <p className="auth-success" role="status">{authMessage}</p>}
          <Button type="submit" size="lg" disabled={authBusy}>{authBusy ? "処理中..." : signUpMode ? "アカウントを作成" : "ログイン"}</Button>
        </form>
        <div className="auth-links"><button className="auth-switch" onClick={() => { setSignUpMode(!signUpMode); setAuthError(""); setAuthMessage(""); }}>{signUpMode ? "ログインに戻る" : "初めて使う方はこちら"}</button><button className="auth-switch" onClick={() => { clearConfig(); setConfig({ url: "", key: "" }); setSetupUrl(""); setSetupKey(""); setAuthError(""); }}>接続先を変更</button></div>
      </section>
    </main>
  );

  return (
    <main className="app-shell">
      <Toaster position="bottom-right" richColors />
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><CircuitBoard size={21} strokeWidth={2.2} /></span><span>PartBase</span><span className="brand-divider" /><span className="brand-caption">電子部品の在庫管理</span></div>
        <div className="header-actions"><Button variant="ghost" size="sm" aria-label="ログアウト" onClick={() => void client.auth.signOut()}><LogOut size={17} /><span>ログアウト</span></Button><Button onClick={openCreate} className="top-add" aria-label="部品を追加"><Plus size={18} /> <span>部品を追加</span></Button></div>
      </header>
      <div className="main-wrap">
        <section className="heading-row">
          <div><div className="eyebrow">INVENTORY</div><h1>部品一覧</h1><p>必要な部品を見つけて、在庫をすばやく更新。</p></div>
          <div className="summary" aria-label="在庫の概要">
            <div><span>登録部品</span><strong>{parts.length}<small>種類</small></strong></div>
            <div><span>在庫総数</span><strong>{totalQuantity}<small>個</small></strong></div>
            <div className={lowCount ? "summary-alert" : ""}><span>残りわずか・在庫なし</span><strong>{lowCount}<small>種類</small></strong></div>
          </div>
        </section>

        <section className="workspace" aria-label="部品データベース">
          <div className="toolbar">
            <div className="search-box"><Search size={19} /><Input aria-label="部品を検索" placeholder="名前・型番・タグ・保管場所で検索" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="検索を消去" onClick={() => setQuery("")}><X size={16} /></button>}</div>
            <div className="filter-group"><SlidersHorizontal size={17} className="filter-icon" />
              <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="カテゴリで絞り込み"><SelectValue placeholder="カテゴリ" /></SelectTrigger><SelectContent><SelectItem value="all">すべてのカテゴリ</SelectItem>{categories.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
              <Select value={stock} onValueChange={setStock}><SelectTrigger aria-label="在庫状態で絞り込み"><SelectValue placeholder="在庫状態" /></SelectTrigger><SelectContent><SelectItem value="all">すべての在庫</SelectItem><SelectItem value="low">残りわずか（1〜5個）</SelectItem><SelectItem value="zero">在庫なし</SelectItem></SelectContent></Select>
              {tags.length > 0 && <Select value={tag} onValueChange={setTag}><SelectTrigger aria-label="タグで絞り込み"><SelectValue placeholder="タグ" /></SelectTrigger><SelectContent><SelectItem value="all">すべてのタグ</SelectItem>{tags.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>}
            </div>
          </div>
          <div className="list-header"><span>{hasFilter ? `検索結果 ${visible.length} 件` : `すべての部品 · ${visible.length} 件`}</span>{hasFilter && <button className="clear-filters" onClick={() => { setQuery(""); setCategory("all"); setStock("all"); setTag("all"); }}>絞り込みを解除</button>}</div>

          {loading ? <div className="empty-state"><Boxes size={32} /><h2>読み込み中...</h2></div> :
            loadError ? <div className="empty-state"><Boxes size={32} /><h2>部品を読み込めませんでした</h2><p>{loadError}</p><Button onClick={() => void load()} variant="outline">再試行</Button></div> :
            visible.length === 0 ? <div className="empty-state"><PackagePlus size={34} /><h2>{hasFilter ? "該当する部品がありません" : "最初の部品を登録しましょう"}</h2><p>{hasFilter ? "検索語や絞り込みを変えてみてください。" : "名前と数量だけでも登録できます。詳細は後から追加できます。"}</p>{!hasFilter && <Button onClick={openCreate}><Plus size={17} />部品を追加</Button>}</div> :
            <div className="parts-list">{visible.map(part => <article className="part-row" key={part.id}>
              <div className="part-visual">{part.imageUrl ? <img src={part.imageUrl} alt="" /> : <CircuitBoard size={26} strokeWidth={1.4} />}</div>
              <div className="part-main"><button className="part-title" onClick={() => openEdit(part)}>{part.name}</button><div className="part-sub">{part.model && <span className="model">{part.model}</span>}{part.category && <span className="category-chip">{part.category}</span>}</div>{part.tags.length > 0 && <div className="tag-line">{part.tags.map(value => <span key={value}>#{value}</span>)}</div>}</div>
              <div className="part-location">{part.location ? <><MapPin size={16} /><span>{part.location}</span></> : <span className="muted">場所未設定</span>}</div>
              <div className="part-stock"><div className={part.quantity === 0 ? "stock-label out" : part.quantity <= 5 ? "stock-label low" : "stock-label"}>{part.quantity === 0 ? "在庫なし" : part.quantity <= 5 ? "残りわずか" : "在庫あり"}</div><div className="stock-control"><Button variant="outline" size="icon-sm" aria-label={`${part.name}を1個減らす`} disabled={part.quantity === 0 || busyId !== null} onClick={() => void adjust(part, -1)}><Minus size={16} /></Button><strong aria-label={`在庫${part.quantity}個`}>{part.quantity}</strong><Button variant="outline" size="icon-sm" aria-label={`${part.name}を1個増やす`} disabled={busyId !== null} onClick={() => void adjust(part, 1)}><Plus size={16} /></Button></div></div>
              <Button variant="ghost" size="sm" className="edit-button" onClick={() => openEdit(part)}>詳細・編集</Button>
            </article>)}</div>}
        </section>
      </div>

      <Dialog open={formOpen} onOpenChange={open => { if (!saving) setFormOpen(open); }}>
        <DialogContent className="part-dialog">
          <DialogHeader><DialogTitle>{editing ? "部品の詳細・編集" : "部品を追加"}</DialogTitle><DialogDescription>{editing ? "情報を修正したら保存してください。" : "まずは名前と数量だけでも登録できます。"}</DialogDescription></DialogHeader>
          <div className="form-scroll"><div className="form-grid">
            <label className="field wide"><span>部品名 <em>必須</em></span><Input autoFocus value={draft.name} maxLength={160} placeholder="例：積層セラミックコンデンサ" onChange={e => setField("name", e.target.value)} /></label>
            <label className="field"><span>型番</span><Input value={draft.model} maxLength={160} placeholder="例：GRM188R71C104KA01" onChange={e => setField("model", e.target.value)} /></label>
            <label className="field"><span>カテゴリ</span><Input value={draft.category} maxLength={80} placeholder="例：コンデンサ" list="category-options" onChange={e => setField("category", e.target.value)} /><datalist id="category-options">{categories.map(value => <option key={value} value={value} />)}</datalist></label>
            <label className="field"><span>数量</span><Input type="number" min="0" max="1000000000" step="1" value={draft.quantity} onChange={e => setField("quantity", Number(e.target.value))} /></label>
            <label className="field"><span>保管場所</span><Input value={draft.location} maxLength={160} placeholder="例：棚A / 引き出し3" onChange={e => setField("location", e.target.value)} /></label>
            <label className="field wide"><span>タグ</span><Input value={tagText} placeholder="例：SMD, 0603, 予備（カンマ区切り）" onChange={e => setTagText(e.target.value)} /></label>
            <label className="field wide"><span>仕様</span><Textarea value={draft.specifications} maxLength={4000} placeholder="容量、定格電圧、許容差など" rows={3} onChange={e => setField("specifications", e.target.value)} /></label>
            <label className="field"><span>購入先</span><Input value={draft.supplier} maxLength={160} placeholder="例：秋月電子" onChange={e => setField("supplier", e.target.value)} /></label>
            <label className="field"><span>データシートURL</span><Input type="url" value={draft.datasheetUrl} maxLength={1000} placeholder="https://..." onChange={e => setField("datasheetUrl", e.target.value)} /></label>
            <div className="field wide"><span>画像</span><label className="image-upload"><ImagePlus size={19} /><span>{imageFile ? imageFile.name : editing?.imageUrl && !removeImage ? "画像を変更する" : "画像を選ぶ"}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { setImageFile(e.target.files?.[0] || null); setRemoveImage(false); }} /></label><small>JPEG・PNG・WebP・GIF、5MB以下</small>{editing?.imageUrl && !removeImage && <button className="text-action" type="button" onClick={() => { setRemoveImage(true); setImageFile(null); }}>現在の画像を削除</button>}</div>
          </div></div>
          <DialogFooter className="form-footer">{editing && <Button variant="ghost" className="delete-button" onClick={() => setDeleteTarget(editing)}><Trash2 size={16} />削除</Button>}<div className="footer-actions"><Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>キャンセル</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "保存中..." : editing ? "変更を保存" : "部品を追加"}</Button></div></DialogFooter>
          {editing?.datasheetUrl && <a className="datasheet-link" href={editing.datasheetUrl} target="_blank" rel="noopener noreferrer">データシートを開く <ExternalLink size={14} /></a>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>この部品を削除しますか？</AlertDialogTitle><AlertDialogDescription>「{deleteTarget?.name}」の情報と画像が削除されます。この操作は元に戻せません。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><AlertDialogAction onClick={() => void remove()} className="confirm-delete">削除する</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </main>
  );
}
