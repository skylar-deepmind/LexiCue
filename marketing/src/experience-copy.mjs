import {manualCopy} from './manual-copy.mjs';
import imageSizes from './guide-image-sizes.json' with {type:'json'};
export const languages=['en','zh','ja','de'];
const rows={
fullImage:['View full-size image','查看大图','画像を拡大','Bild in voller Größe'],experience:['Online experience','在线体验','オンライン体験','Online ausprobieren'],manual:['User guide','使用手册','使い方ガイド','Handbuch'],guide:['Show tips','查看引导','ヒントを表示','Tipps anzeigen'],reset:['Reset experience','重置体验','体験をリセット','Demo zurücksetzen'],tutorial:['Read this tutorial','查看本页教程','このページの説明','Anleitung öffnen'],sample:['Interactive sample · original content','交互样例 · 原创内容','操作できるサンプル · オリジナル教材','Interaktives Beispiel · eigene Inhalte'],try:['Try it','试一下','試してみる','Ausprobieren'],close:['Close','关闭','閉じる','Schließen'],done:['Done — your sample has been updated.','完成，样例数据已更新。','完了。サンプルに反映しました。','Erledigt — das Beispiel wurde aktualisiert.'],files:['Files','文件','ファイル','Dateien'],vocabulary:['Vocabulary','词汇','語彙','Wortschatz'],words:['Words','单词','単語','Wörter'],phrases:['Phrases','词组','フレーズ','Wendungen'],review:['Review','复习','復習','Wiederholen'],insights:['Insights','统计','学習記録','Statistik'],settings:['Settings','设置','設定','Einstellungen'],reading:['Reading','阅读','読む','Lesen'],all:['All','全部','すべて','Alle'],untagged:['Untagged','无标签','タグなし','Ohne Tags'],manage:['Manage tags','管理标签','タグを管理','Tags verwalten'],matchAll:['Files must match every selected tag.','同时匹配所有所选标签。','選択したタグすべてに一致するファイル。','Dateien müssen alle gewählten Tags enthalten.'],clear:['Clear filters','清除筛选','絞り込みを解除','Filter zurücksetzen'],noFiles:['No matching files. Try clearing the filters.','没有匹配的文件，试试清除筛选。','該当するファイルがありません。絞り込みを解除してください。','Keine passenden Dateien. Setze die Filter zurück.'],editTags:['Edit tags','编辑标签','タグを編集','Tags bearbeiten'],create:['Create tag','创建标签','タグを作成','Tag erstellen'],rename:['Rename','重命名','名前を変更','Umbenennen'],delete:['Delete','删除','削除','Löschen'],save:['Save','保存','保存','Speichern'],cancel:['Cancel','取消','キャンセル','Abbrechen'],tagName:['Tag name','标签名称','タグ名','Tagname'],tagError:['Enter a unique tag name (1–40 characters).','请输入不重复的标签名称（1–40 字）。','重複しないタグ名を1〜40文字で入力してください。','Gib einen eindeutigen Tagnamen mit 1–40 Zeichen ein.'],deleteTag:['Delete this tag? Files will be kept.','删除这个标签？文件会保留。','このタグを削除しますか？ファイルは残ります。','Tag löschen? Die Dateien bleiben erhalten.'],import:['Import a sample','导入样例','サンプルを取り込む','Beispiel importieren'],youtube:['YouTube sample','YouTube 样例','YouTube の例','YouTube-Beispiel'],preview:['Import preview','导入预览','取り込みプレビュー','Importvorschau'],confirm:['Confirm import','确认导入','取り込みを確定','Import bestätigen'],next:['Next','下一步','次へ','Weiter'],language:['Learning language','学习语言','学習言語','Lernsprache'],selectSample:['Choose a prepared sample. No personal files are read.','选择预置样例，不读取个人文件。','用意されたサンプルを選択します。個人のファイルは読みません。','Wähle ein vorbereitetes Beispiel. Persönliche Dateien werden nicht gelesen.'],alreadyImported:['This sample is already in your library.','这个样例已在文件库中。','このサンプルは取り込み済みです。','Dieses Beispiel ist bereits in deiner Bibliothek.'],back:['Back to files','返回文件库','ファイル一覧へ','Zurück zu Dateien'],dictionary:['Offline dictionary · original sample definitions','离线词典 · 原创样例释义','オフライン辞書 · オリジナルの語釈','Offline-Wörterbuch · eigene Beispieldefinitionen'],original:['Original context','原文语境','元の文脈','Originalkontext'],source:['Go to source','返回原文','原文へ','Zur Fundstelle'],status:['Learning status','学习状态','学習状態','Lernstatus'],unprocessed:['Unprocessed','未处理','未処理','Unbearbeitet'],learning:['Learning','学习中','学習中','In Arbeit'],known:['Known','已掌握','習得済み','Bekannt'],ignored:['Ignored','忽略','対象外','Ignoriert'],search:['Search vocabulary','搜索词汇','語彙を検索','Wortschatz durchsuchen'],empty:['Nothing here yet. Change the filter or explore a file.','这里暂时没有内容，可以调整筛选或阅读文件。','まだ項目がありません。絞り込みを変えるか、ファイルを読んでください。','Noch keine Einträge. Ändere den Filter oder öffne eine Datei.'],enableAI:['Enable sample AI','开启样例 AI','サンプル AI を有効化','Beispiel-KI aktivieren'],analyze:['Analyze context','分析语境','文脈を分析','Kontext analysieren'],fixedAI:['Optional AI · fixed sample result; accelerated demonstration','可选 AI · 固定样例结果；演示已加速','任意の AI · 固定サンプル結果、時間を短縮したデモ','Optionale KI · festes Beispielergebnis; verkürzte Demo'],context:['This sentence connects small, regular actions with a result that matters.','这句话把微小、持续的行动与有价值的结果联系起来。','小さな行動の積み重ねが、価値のある結果につながるという文脈です。','Der Satz verbindet kleine, regelmäßige Schritte mit einem bedeutsamen Ergebnis.'],contextOther:['The highlighted words are explained in their original context.','高亮词语结合原句理解，释义来自固定样例。','ハイライトした語を元の文脈で理解します。説明は固定サンプルです。','Die markierten Wörter werden im Originalkontext erklärt. Die Erklärung ist ein festes Beispiel.'],showAnswer:['Show answer','显示答案','答えを表示','Antwort zeigen'],reviewDone:['This sample review is complete.','本轮样例复习完成。','今回のサンプル復習は完了です。','Diese Beispielrunde ist abgeschlossen.'],schedule:['Sample schedule · next review:','演示安排 · 下次复习：','サンプルの予定 · 次の復習：','Beispielplan · nächste Wiederholung:'],minutes:['10 minutes','10 分钟','10分後','10 Minuten'],day:['1 day','1 天','1日後','1 Tag'],days:['3 days','3 天','3日後','3 Tage'],week:['7 days','7 天','7日後','7 Tage'],reviewCount:['Reviews in this session','本次体验复习次数','今回の体験での復習回数','Wiederholungen in dieser Sitzung'],history:['Seven days · fixed sample history + this session','七日记录 · 固定样例历史与本次操作','7日間 · 固定サンプル履歴と今回の操作','Sieben Tage · Beispielverlauf und diese Sitzung'],fileProgress:['File learning progress','文件学习进度','ファイル別の進捗','Lernfortschritt je Datei'],simulated:['Simulated operation · no network, installation or account access','模拟操作 · 不联网、不安装、不读取账号','シミュレーション · 通信・インストール・アカウントへのアクセスなし','Simulation · ohne Netzwerk, Installation oder Kontozugriff'],simulationDone:['Simulation complete. This is a prepared example, not a live service result.','模拟完成。这是预置样例，并非真实服务结果。','シミュレーション完了。実際のサービスの応答ではなく、用意された例です。','Simulation abgeschlossen. Ein vorbereitetes Beispiel, kein Ergebnis eines echten Dienstes.'],uiLanguage:['Interface language','界面语言','表示言語','Oberflächensprache'],baseline:['Frequency baseline','高频词起步','頻出語の初期設定','Häufige Wörter als Grundlage'],sync:['Cloud sync','云同步','クラウド同期','Cloud-Synchronisierung'],ai:['AI analysis','AI 分析','AI 分析','KI-Analyse'],youtubeSettings:['YouTube import','YouTube 导入','YouTube 取り込み','YouTube-Import'],theme:['Product theme','产品主题','製品テーマ','Produktthema'],dictionarySettings:['Dictionaries','词典管理','辞書管理','Wörterbücher'],storage:['Storage usage','存储占用','ストレージ使用量','Speicherbelegung'],updates:['App updates','应用更新','アプリの更新','App-Updates'],themeHint:['Changes apply only to the product window.','仅改变产品体验窗口的主题。','製品ウィンドウのテーマだけを変更します。','Ändert nur das Thema des Produktfensters.'],uiHint:['The website language stays unchanged.','不改变外层网站语言。','サイト自体の言語は変わりません。','Die Sprache der Website bleibt unverändert.'],apply:['Apply to sample words','应用到样例词汇','サンプル語彙に適用','Auf Beispielwörter anwenden'],revoke:['Undo baseline','撤销高频词设置','頻出語設定を取り消す','Grundlage zurücknehmen'],baselineHint:['English and Chinese only. A small sample, not a complete frequency list.','仅支持英语、中文；这里仅演示少量词汇，不是完整高频词表。','英語と中国語のみ。少量のサンプルで、完全な頻出語リストではありません。','Nur Englisch und Chinesisch. Ein kleines Beispiel, keine vollständige Häufigkeitsliste.'],enabled:['Enabled','已启用','有効','Aktiviert'],disabled:['Disabled','未启用','無効','Deaktiviert'],local:['Local Gemma','本地 Gemma','ローカル Gemma','Lokales Gemma'],cloud:['Cloud API','云端 API','クラウド API','Cloud-API'],connect:['Simulate connection','模拟连接','接続をシミュレート','Verbindung simulieren'],downloadModel:['Simulate model download','模拟模型下载','モデル取得をシミュレート','Modelldownload simulieren'],syncAction:['Simulate encrypted sync','模拟加密同步','暗号化同期をシミュレート','Verschlüsselte Synchronisierung simulieren'],installTool:['Simulate tool installation','模拟工具安装','ツール導入をシミュレート','Toolinstallation simulieren'],dictAction:['Simulate dictionary import','模拟词典导入','辞書取り込みをシミュレート','Wörterbuchimport simulieren'],recalculate:['Recalculate sample usage','重新计算样例占用','サンプル使用量を再計算','Beispielbelegung neu berechnen'],checkUpdate:['Simulate update check','模拟检查更新','更新確認をシミュレート','Updateprüfung simulieren'],version:['Current app version','当前应用版本','現在のアプリバージョン','Aktuelle App-Version'],backup:['Sample backup','样例备份','サンプルのバックアップ','Beispielsicherung'],restore:['Restore sample backup','恢复样例备份','サンプルを復元','Beispielsicherung wiederherstellen'],backupDone:['A snapshot of this sample session is ready to restore.','已保存当前样例快照，可点击恢复。','現在のサンプルを保存しました。復元できます。','Eine Momentaufnahme dieser Beispielsitzung kann wiederhergestellt werden.'],resetConfirm:['Reset all sample files, tags, learning records and settings?','重置全部样例文件、标签、学习记录和体验设置？','サンプルのファイル・タグ・学習記録・設定をすべてリセットしますか？','Alle Beispieldateien, Tags, Lernaufzeichnungen und Einstellungen zurücksetzen?'],docsIntro:['Learn by trying, then explore the details.','先动手体验，再了解每个细节。','まず試してから、詳しく学びましょう。','Erst ausprobieren, dann die Details entdecken.'],docsCTA:['Open the user guide','打开使用手册','使い方ガイドを開く','Handbuch öffnen'],purpose:['What it does','功能用途','できること','Wozu es dient'],steps:['Step by step','操作步骤','操作の流れ','Schritt für Schritt'],result:['What to expect','结果与说明','結果と説明','Ergebnis und Hinweise'],trySample:['Try this in the sample','在样例中试一下','サンプルで試す','Im Beispiel ausprobieren'],related:['Related chapters','相关章节','関連する章','Weitere Kapitel'],contents:['On this page','本页目录','このページの目次','Auf dieser Seite'],chapters:['Chapters','章节目录','章の一覧','Kapitel'],websiteVsApp:['The online sample uses prepared data. The installed app works with your own files.','在线体验使用预置数据；安装版用于学习你自己的文件。','オンライン体験は用意されたデータを使用します。インストール版では自分のファイルを学習できます。','Das Online-Beispiel nutzt vorbereitete Daten. Die installierte App arbeitet mit deinen eigenen Dateien.'],animation:['Watch the short demonstration','观看简短演示','短いデモを見る','Kurze Demo ansehen'],imageAlt:['Product interface screenshot','产品界面截图','製品画面のスクリーンショット','Screenshot der Produktoberfläche'],privacyFAQ:['Learning data is stored locally by default. Cloud AI and sync require you to enable them.','学习数据默认保存在本地；云端 AI 与同步需要主动启用。','学習データは標準でローカルに保存されます。クラウド AI と同期は自分で有効にします。','Lerndaten bleiben standardmäßig lokal. Cloud-KI und Synchronisierung werden ausdrücklich aktiviert.'],modelFAQ:['The installed app needs a separate local model download for local AI. Cloud AI requires your chosen service configuration.','安装版的本地 AI 需要另行下载模型；云端 AI 需要配置所选服务。','インストール版のローカル AI にはモデルの追加取得が必要です。クラウド AI は利用するサービスの設定が必要です。','Lokale KI benötigt in der installierten App einen separaten Modelldownload. Cloud-KI braucht die Konfiguration des gewählten Dienstes.'],platformFAQ:['Install LexiCue on macOS, Windows or Android. YouTube tooling and installation steps vary by platform; see the distribution guide.','LexiCue 需要安装，支持 macOS、Windows、Android。YouTube 工具和安装步骤因平台而异，请查看安装说明。','LexiCue は macOS・Windows・Android にインストールして使います。YouTube ツールと導入手順は環境によって異なります。配布ガイドをご覧ください。','LexiCue wird auf macOS, Windows oder Android installiert. YouTube-Werkzeuge und Installationsschritte unterscheiden sich je Plattform; siehe Installationsanleitung.'],daily:['Daily','日常','日常','Alltag'],podcast:['Podcast','播客','ポッドキャスト','Podcast'],short:['Short film','短片','短編','Kurzfilm'],favorite:['Favorites','收藏','お気に入り','Favoriten'],segments:['segments','句字幕','文','Abschnitte'],more:['Sample tools','样例工具','サンプルツール','Beispielwerkzeuge'],noBackup:['Create a sample backup first.','请先创建样例备份。','先にサンプルをバックアップしてください。','Erstelle zuerst eine Beispielsicherung.'],switchOff:['Turn off','关闭功能','無効にする','Ausschalten'],enable:['Enable','启用','有効にする','Aktivieren']
};
export const experienceCopy=Object.fromEntries(languages.map((l,i)=>[l,Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v[i]]))]));
export const chapterIds=['quick-start','files','reading','vocabulary','review','insights','settings','faq'];
const chapterRows=[
 [
  [
   "Quick start",
   "快速开始",
   "クイックスタート",
   "Schnellstart"
  ],
  "files",
  "lookup"
 ],
 [
  [
   "Files and tags",
   "文件与标签",
   "ファイルとタグ",
   "Dateien und Tags"
  ],
  "files",
  "import"
 ],
 [
  [
   "Reading and lookup",
   "阅读与查词",
   "読む・辞書で調べる",
   "Lesen und Nachschlagen"
  ],
  "reading",
  "lookup"
 ],
 [
  [
   "Vocabulary and phrases",
   "词汇与词组",
   "単語とフレーズ",
   "Wörter und Wendungen"
  ],
  "vocabulary",
  "collect"
 ],
 [
  [
   "Review",
   "复习",
   "復習",
   "Wiederholen"
  ],
  "review",
  "review"
 ],
 [
  [
   "Insights",
   "统计",
   "学習記録",
   "Statistik"
  ],
  "insights",
  "progress"
 ],
 [
  [
   "Settings",
   "设置",
   "設定",
   "Einstellungen"
  ],
  "settings",
  "languages"
 ],
 [
  [
   "Frequently asked questions",
   "常见问题",
   "よくある質問",
   "Häufige Fragen"
  ],
  "settings",
  "privacy"
 ]
];
export const guides=Object.fromEntries(languages.map((locale,index)=>[locale,chapterRows.map((row,n)=>({id:chapterIds[n],title:row[0][index],intro:manualCopy[locale].descriptions[chapterIds[n]],module:row[1],scene:row[2],imageSize:imageSizes[locale]?.[chapterIds[n]]||{width:1100,height:653}}))]));
const hints={files:[['Filter a library with tags, then open a file.','用标签快速筛选，然后打开文件。','タグで絞り込んでから、ファイルを開きましょう。','Filtere die Bibliothek mit Tags und öffne eine Datei.'],'filter'],reading:[['Select a highlighted word and change its learning status.','点击高亮单词，试着修改学习状态。','ハイライトした単語を選び、学習状態を変えてみましょう。','Wähle ein markiertes Wort und ändere seinen Lernstatus.'],'term'],words:[['Search a word, filter its status, or return to its source.','搜索单词、筛选状态，或返回原文。','単語を検索・絞り込み、原文に戻ってみましょう。','Suche ein Wort, filtere den Status oder öffne die Fundstelle.'],'search'],phrases:[['Explore expressions and the sentences they came from.','查看词组及它们出现的原句。','フレーズと、その元の文を見てみましょう。','Erkunde Wendungen und ihre Originalssätze.'],'search'],review:[['Recall the meaning, reveal the answer, then rate yourself.','回忆含义，揭示答案，再为记忆评分。','意味を思い出し、答えを見て評価しましょう。','Erinnere dich, zeige die Antwort und bewerte dich.'],'answer'],insights:[['Your sample actions update the learning record here.','你的样例操作会更新这里的学习记录。','サンプルの操作が、ここに反映されます。','Deine Beispielaktionen aktualisieren die Lernaufzeichnung hier.'],'stat'],settings:[['Try another product theme; the website stays unchanged.','试试另一个产品主题，外层网页保持原样。','製品テーマを変えてみましょう。サイトの外観は変わりません。','Probiere ein Produktthema. Die Website bleibt unverändert.'],'theme']};
export const guidance=Object.fromEntries(languages.map((l,i)=>[l,Object.fromEntries(Object.entries(hints).map(([k,v])=>[k,{text:v[0][i],target:v[1]}]))]));
