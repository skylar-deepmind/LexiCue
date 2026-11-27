const rows={
 source:['Source and build instructions','源码与构建说明','ソースとビルド手順','Quellcode und Build-Anleitung'],
 reset:['Reset demo','重置演示','デモをリセット','Demo zurücksetzen'],
 resetConfirm:['Restore the original demo materials and saved contexts? This only resets demo data in this tab.','恢复初始演示材料与收藏？只影响当前标签页的演示数据。','最初のデモ素材と保存した文脈に戻しますか？このタブのデモデータだけをリセットします。','Ursprüngliche Demomaterialien und gespeicherte Kontexte wiederherstellen? Nur die Demodaten dieses Tabs werden zurückgesetzt.'],
 workspace:['Workspace','工作区','ワークスペース','Arbeitsbereich'],
 onlineApp:['LexiCue online workspace','LexiCue 在线工作区','LexiCue オンラインワークスペース','LexiCue Online-Arbeitsbereich'],
 download:['Download','下载','ダウンロード','Download'],
 support:['Support','支持','支援','Unterstützen'],
 downloadSummary:['Download the notarized macOS v0.4.7 DMG for Apple Silicon or Intel. Windows and Android downloads are available in v0.4.5.', 'macOS v0.4.7 提供 Apple Silicon 和 Intel 的公证 DMG。Windows 与 Android 安装包可在 v0.4.5 下载。', 'macOS v0.4.7 では、Apple Silicon と Intel 向けの公証済み DMG をダウンロードできます。Windows と Android 向けは v0.4.5 を利用できます。', 'Für macOS v0.4.7 gibt es notarisierte DMG-Dateien für Apple Silicon und Intel. Windows und Android sind als v0.4.5 verfügbar.'],
 demoNote:["Use the online workspace with temporary sample data. Real device pairing and native update services are not connected; files, clipboard and speech use browser capabilities and applicable permissions.","在线工作区使用临时样例数据。不连接真实设备配对与原生更新服务；文件、剪贴板和朗读使用浏览器能力及相应授权。","オンラインは一時的なサンプルデータを使います。実際の端末ペアリングやネイティブ更新サービスには接続しません。ファイル・クリップボード・読み上げはブラウザの機能と必要な許可を使います。","Der Online-Arbeitsbereich nutzt temporäre Beispieldaten. Echte Gerätekopplung und native Update-Dienste sind nicht verbunden. Dateien, Zwischenablage und Sprachausgabe nutzen Browserfunktionen und erforderliche Berechtigungen."],
 javascript:['Enable JavaScript to use the online workspace, or open the user guide.','请启用 JavaScript 使用在线工作区，或打开使用手册。','オンラインワークスペースには JavaScript が必要です。使い方ガイドもご覧いただけます。','Aktiviere JavaScript für den Online-Arbeitsbereich oder öffne das Handbuch.'],
 supportBody:['Support LexiCue’s development or explore the source on GitHub.','支持 LexiCue 的开发，或在 GitHub 查看源码。','LexiCue の開発を支援したり、GitHub でソースを確認したりできます。','Unterstütze die Entwicklung von LexiCue oder erkunde den Quellcode auf GitHub.']
};
export const currentCopy=Object.fromEntries(['en','zh','ja','de'].map((l,i)=>[l,Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v[i]]))]));
export const screenshotScenes=['materials','reading','lookup','saved','recall','settings'];
export const screenshotPath=(locale,scene,theme,device='desktop')=>`media/current/${locale}/${scene}-${theme}-${device}.webp`;
