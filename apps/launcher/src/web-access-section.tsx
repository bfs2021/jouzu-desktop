import { useCallback, useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { ArrowUpRight, Copy, Link2, Trash2 } from "lucide-react";
import { useApi } from "./api/context";
import type { WebAccessMode, WebAccessPairing, WebAccessState } from "./api/jouzu-api";
import type { Locale } from "./i18n";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import { ErrorLine } from "./session-alerts-view";
import { copyText } from "./secure-context";

interface Text {
  title: string; hint: string; scope: string;
  off: string; local: string; networks: string;
  offHint: string; localHint: string; networksHint: string;
  trusted: string; lan: string; tailnet: string; noNetworks: string; unavailable: string;
  save: string; serving: string; notServing: string;
  plainLan: string;
  pair: string; pairHint: string; code: string; expires: string; copy: string; copied: string; open: string; cancel: string; done: string;
  devices: string; noDevices: string; lastSeen: string; never: string; remove: string; removeAll: string;
  confirmRemoveAll: string; failed: string;
}

const text: Record<Locale, Text> = {
  en: {
    title: "Web access", hint: "Use Jouzu from a browser on this computer, or from another device on a network you trust. Every browser must be paired with this app first.", scope: "Who can connect",
    off: "Off", local: "This computer only", networks: "This computer and trusted networks",
    offHint: "Only this window uses Jouzu. Browsers and other devices cannot connect.", localHint: "A paired browser on this computer can connect. Other devices are refused.", networksHint: "Paired devices on the networks you turn on below can connect. Everything else is refused.",
    trusted: "Trusted networks", lan: "Local network", tailnet: "Tailscale", noNetworks: "No private network was found on this computer.", unavailable: "Turned on but not connected now:",
    save: "Save", serving: "Serving at", notServing: "Could not start on",
    plainLan: "Traffic on a local network is not encrypted. Use it only on networks you control. Tailscale traffic is encrypted.",
    pair: "Pair a device", pairHint: "Open the link or scan the code on the device you want to pair, or open the address there and type the code. The code works once and expires in", code: "Pairing code", expires: "minutes", copy: "Copy link", copied: "Copied", open: "Open in browser", cancel: "Cancel", done: "Paired",
    devices: "Paired devices", noDevices: "No device is paired yet.", lastSeen: "Last seen", never: "never", remove: "Remove", removeAll: "Remove all",
    confirmRemoveAll: "Remove every paired device? Each one has to be paired again to connect.", failed: "The web access change did not complete.",
  },
  ja: {
    title: "Web アクセス", hint: "このコンピューターのブラウザー、または信頼できるネットワーク上の別のデバイスから Jouzu を使えます。どのブラウザーも、先にこのアプリとのペアリングが必要です。", scope: "接続できる範囲",
    off: "オフ", local: "このコンピューターのみ", networks: "このコンピューターと信頼できるネットワーク",
    offHint: "Jouzu を使えるのはこのウィンドウだけです。ブラウザーや他のデバイスからは接続できません。", localHint: "このコンピューター上のペアリング済みブラウザーが接続できます。他のデバイスは拒否されます。", networksHint: "下でオンにしたネットワーク上のペアリング済みデバイスが接続できます。それ以外は拒否されます。",
    trusted: "信頼できるネットワーク", lan: "ローカルネットワーク", tailnet: "Tailscale", noNetworks: "このコンピューターにプライベートネットワークが見つかりません。", unavailable: "オンにしているが現在つながっていないもの:",
    save: "保存", serving: "公開中のアドレス", notServing: "開始できませんでした:",
    plainLan: "ローカルネットワーク上の通信は暗号化されません。自分で管理しているネットワークでのみ使ってください。Tailscale の通信は暗号化されます。",
    pair: "デバイスをペアリング", pairHint: "ペアリングするデバイスでリンクを開くかコードを読み取るか、アドレスを開いてコードを入力してください。コードは 1 回だけ使え、有効期限は", code: "ペアリングコード", expires: "分です", copy: "リンクをコピー", copied: "コピーしました", open: "ブラウザーで開く", cancel: "キャンセル", done: "ペアリングしました",
    devices: "ペアリング済みデバイス", noDevices: "ペアリング済みのデバイスはありません。", lastSeen: "最終接続", never: "なし", remove: "削除", removeAll: "すべて削除",
    confirmRemoveAll: "ペアリング済みのデバイスをすべて削除しますか？ 接続するには再度ペアリングが必要です。", failed: "Web アクセスの変更を完了できませんでした。",
  },
  "zh-Hans": {
    title: "Web 访问", hint: "可以在这台电脑的浏览器里，或在可信网络上的其他设备上使用 Jouzu。每个浏览器都要先和本应用配对。", scope: "允许谁连接",
    off: "关闭", local: "仅这台电脑", networks: "这台电脑和可信网络",
    offHint: "只有这个窗口能使用 Jouzu，浏览器和其他设备都无法连接。", localHint: "这台电脑上已配对的浏览器可以连接，其他设备会被拒绝。", networksHint: "下面开启的网络上已配对的设备可以连接，其他一律拒绝。",
    trusted: "可信网络", lan: "局域网", tailnet: "Tailscale", noNetworks: "这台电脑上没有找到私有网络。", unavailable: "已开启但当前未连接：",
    save: "保存", serving: "正在提供服务的地址", notServing: "无法启动：",
    plainLan: "局域网上的通信未加密，请只在你自己管理的网络上使用。Tailscale 的通信是加密的。",
    pair: "配对设备", pairHint: "在要配对的设备上打开链接或扫描二维码，或者打开地址后输入配对码。配对码只能用一次，有效期", code: "配对码", expires: "分钟", copy: "复制链接", copied: "已复制", open: "在浏览器中打开", cancel: "取消", done: "已配对",
    devices: "已配对设备", noDevices: "还没有配对的设备。", lastSeen: "最近连接", never: "从未", remove: "移除", removeAll: "全部移除",
    confirmRemoveAll: "移除所有已配对设备？之后每台设备都要重新配对才能连接。", failed: "Web 访问的更改没有完成。",
  },
  "zh-Hant": {
    title: "Web 存取", hint: "可以在這台電腦的瀏覽器中，或在可信網路上的其他裝置上使用 Jouzu。每個瀏覽器都要先與本應用程式配對。", scope: "允許誰連線",
    off: "關閉", local: "僅這台電腦", networks: "這台電腦與可信網路",
    offHint: "只有這個視窗能使用 Jouzu，瀏覽器與其他裝置都無法連線。", localHint: "這台電腦上已配對的瀏覽器可以連線，其他裝置會被拒絕。", networksHint: "下方開啟的網路上已配對的裝置可以連線，其他一律拒絕。",
    trusted: "可信網路", lan: "區域網路", tailnet: "Tailscale", noNetworks: "這台電腦上沒有找到私人網路。", unavailable: "已開啟但目前未連線：",
    save: "儲存", serving: "正在提供服務的位址", notServing: "無法啟動：",
    plainLan: "區域網路上的通訊未加密，請只在你自己管理的網路上使用。Tailscale 的通訊是加密的。",
    pair: "配對裝置", pairHint: "在要配對的裝置上開啟連結或掃描 QR 碼，或開啟位址後輸入配對碼。配對碼只能使用一次，有效期", code: "配對碼", expires: "分鐘", copy: "複製連結", copied: "已複製", open: "在瀏覽器中開啟", cancel: "取消", done: "已配對",
    devices: "已配對裝置", noDevices: "尚無已配對的裝置。", lastSeen: "最近連線", never: "從未", remove: "移除", removeAll: "全部移除",
    confirmRemoveAll: "移除所有已配對裝置？之後每台裝置都要重新配對才能連線。", failed: "Web 存取的變更沒有完成。",
  },
};

export const webAccessTitle = (locale: Locale) => text[locale].title;

/** A QR code drawn as one SVG path; no network request, no canvas. */
function QrCode({ value, label }: { value: string; label: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { d, size: count + 8 };
  }, [value]);
  return <svg role="img" aria-label={label} viewBox={`0 0 ${path.size} ${path.size}`} className="size-40 shrink-0 rounded-md bg-white" shapeRendering="crispEdges"><path d={path.d} fill="#000" /></svg>;
}

/** Settings → Web access (issue #91): scope, trusted networks, pairing and paired devices. */
export function WebAccessSection({ locale, openUrl, confirm }: { locale: Locale; openUrl: (url: string) => Promise<void>; confirm: (message: string) => Promise<boolean> }) {
  const api = useApi();
  const t = text[locale];
  const [state, setState] = useState<WebAccessState | null>(null);
  const [mode, setMode] = useState<WebAccessMode>("off");
  const [networks, setNetworks] = useState<string[]>([]);
  const [pairing, setPairing] = useState<(WebAccessPairing & { devices: number; until: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [paired, setPaired] = useState<string | null>(null);

  const adopt = useCallback((next: WebAccessState) => {
    setState(next);
    setMode(next.mode);
    setNetworks([...next.networks.filter(network => network.enabled).map(network => network.name), ...next.unavailableNetworks]);
  }, []);

  useEffect(() => {
    let live = true;
    api.settings.webAccess.read().then(next => { if (live) adopt(next); }).catch(failure => { if (live) setError(failure); });
    return () => { live = false; };
  }, [api, adopt]);

  // While a pairing code is open, watch for the new device and for expiry.
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= pairing.until) { setPairing(null); return; }
      api.settings.webAccess.read().then(next => {
        setState(next);
        if (next.devices.length > pairing.devices) {
          setPaired(next.devices[next.devices.length - 1]?.name ?? null);
          setPairing(null);
        }
      }).catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [api, pairing]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await work(); } catch (failure) { setError(failure); } finally { setBusy(false); }
  };

  const saved = state ? state.mode === mode && (mode !== "networks" || sameSet(networks, [...state.networks.filter(network => network.enabled).map(network => network.name), ...state.unavailableNetworks])) : true;
  const lanOn = mode === "networks" && state?.networks.some(network => network.kind === "lan" && networks.includes(network.name));
  const failures = state ? [...(state.localError && state.port ? [`127.0.0.1:${state.port} (${state.localError})`] : []), ...state.networks.filter(network => network.enabled && network.error).map(network => `${network.name} ${network.address} (${network.error})`)] : [];
  const urls = state ? [state.localUrl, ...state.networks.map(network => network.url)].filter((url): url is string => !!url) : [];

  return <Card className="border-border shadow-none">
    <CardHeader><CardTitle>{t.title}</CardTitle><CardDescription>{t.hint}</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      {error !== null && <ErrorLine raw={error} failed={t.failed} onDismiss={() => setError(null)} />}
      <div className="space-y-2">
        <Label htmlFor="web-access-scope">{t.scope}</Label>
        <Select value={mode} disabled={busy || !state} onValueChange={value => setMode(value as WebAccessMode)}>
          <SelectTrigger id="web-access-scope" aria-label={t.scope} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="off">{t.off}</SelectItem><SelectItem value="local">{t.local}</SelectItem><SelectItem value="networks">{t.networks}</SelectItem></SelectContent>
        </Select>
        <p className="text-sm leading-relaxed text-muted-foreground">{mode === "off" ? t.offHint : mode === "local" ? t.localHint : t.networksHint}</p>
      </div>
      {mode === "networks" && state && <div className="space-y-2">
        <p className="text-sm font-medium">{t.trusted}</p>
        {state.networks.length === 0 && <p className="text-sm text-muted-foreground">{t.noNetworks}</p>}
        {state.networks.map(network => <div key={network.name} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div className="min-w-0"><p className="truncate text-sm">{network.name}</p><p className="text-xs text-muted-foreground">{network.kind === "tailnet" ? t.tailnet : t.lan} · {network.address}</p></div>
          <Switch aria-label={network.name} disabled={busy} checked={networks.includes(network.name)} onCheckedChange={on => setNetworks(list => on ? [...list, network.name] : list.filter(name => name !== network.name))} />
        </div>)}
        {state.unavailableNetworks.length > 0 && <p className="text-sm text-muted-foreground">{t.unavailable} {state.unavailableNetworks.join(", ")}</p>}
        {lanOn && <p className="text-sm leading-relaxed text-muted-foreground">{t.plainLan}</p>}
      </div>}
      {!saved && <div className="flex justify-end"><Button disabled={busy || (mode === "networks" && networks.length === 0)} onClick={() => void run(async () => { setPairing(null); adopt(await api.settings.webAccess.update({ mode, networks: mode === "networks" ? networks.filter(name => state?.networks.some(network => network.name === name)) : [] })); })}>{t.save}</Button></div>}
      {saved && state && state.mode !== "off" && <div className="space-y-1">
        {urls.length > 0 && <p className="text-sm text-muted-foreground">{t.serving}: {urls.join(" · ")}</p>}
        {failures.length > 0 && <p role="status" className="text-sm text-destructive">{t.notServing} {failures.join(" · ")}</p>}
      </div>}

      {saved && state && state.mode !== "off" && <div className="space-y-3 border-t border-border pt-5">
        {!pairing && <div className="flex items-center justify-between gap-3">
          {paired ? <p role="status" className="text-sm text-muted-foreground">{t.done}: {paired}</p> : <span />}
          <Button variant="outline" disabled={busy || urls.length === 0} onClick={() => void run(async () => {
            setPaired(null);
            const next = await api.settings.webAccess.pair();
            setPairing({ ...next, devices: state.devices.length, until: Date.now() + next.expiresInSeconds * 1000 });
          })}><Link2 />{t.pair}</Button>
        </div>}
        {pairing && <div className="space-y-4 rounded-lg border border-border p-3">
          <p className="text-sm leading-relaxed text-muted-foreground">{t.pairHint} {Math.round(pairing.expiresInSeconds / 60)} {t.expires}</p>
          <p className="text-center font-mono text-2xl tracking-[0.3em]" aria-label={t.code}>{pairing.code}</p>
          {pairing.links.map(link => <div key={link.url} className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <QrCode value={link.url} label={`${t.pair}: ${link.network}`} />
            <div className="w-full min-w-0 space-y-2">
              <p className="text-sm font-medium">{link.network}</p>
              <Input readOnly aria-label={link.network} value={link.url} onFocus={event => event.target.select()} />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => void copyText(link.url).then(() => setCopied(link.url)).catch(failure => setError(failure))}><Copy />{copied === link.url ? t.copied : t.copy}</Button>
                {new URL(link.url).hostname === "127.0.0.1" && <Button variant="outline" onClick={() => void openUrl(link.url).catch(failure => setError(failure))}><ArrowUpRight />{t.open}</Button>}
              </div>
            </div>
          </div>)}
          <div className="flex justify-end"><Button variant="ghost" onClick={() => void run(async () => { setPairing(null); await api.settings.webAccess.cancelPairing(); })}>{t.cancel}</Button></div>
        </div>}
      </div>}

      {state && (state.devices.length > 0 || state.mode !== "off") && <div className="space-y-2 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{t.devices}</p>
          {state.devices.length > 1 && <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { if (await confirm(t.confirmRemoveAll)) adopt(await api.settings.webAccess.revoke()); })}>{t.removeAll}</Button>}</div>
        {state.devices.length === 0 && <p className="text-sm text-muted-foreground">{t.noDevices}</p>}
        {state.devices.map(device => <div key={device.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div className="min-w-0"><p className="truncate text-sm">{device.name}</p><p className="text-xs text-muted-foreground">{device.network} · {t.lastSeen}: {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : t.never}</p></div>
          <Button variant="ghost" aria-label={`${t.remove} ${device.name}`} disabled={busy} onClick={() => void run(async () => { adopt(await api.settings.webAccess.revoke(device.id)); })}><Trash2 />{t.remove}</Button>
        </div>)}
      </div>}
    </CardContent>
  </Card>;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every(value => b.includes(value));
}
