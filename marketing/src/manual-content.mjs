// Installed-product documentation. Stable section IDs are shared by every locale.
// Each row is English, Chinese, Japanese, German; no demo/session state is read.
const locales=['en','zh','ja','de'];
const chapters={};
const section=(id,title,body=[],steps=[],options={})=>({id,title,body,steps,...options});
const add=(id,intro,sections)=>{chapters[id]={intro,sections};};
add('quick-start',
 ['Install LexiCue and start with one SRT subtitle file. No account is needed for local learning.','安装 LexiCue，从一份 SRT 字幕开始。本地学习无需注册账号。','LexiCueをインストールし、SRT字幕を1つ用意しましょう。ローカル学習にアカウントは不要です。','Installiere LexiCue und starte mit einer SRT-Untertiteldatei. Für lokales Lernen brauchst du kein Konto.'],[
 section('install',['Download and install','下载与安装','ダウンロードとインストール','Herunterladen und installieren'],[],[
  ['Open the release page and choose the package for your device: DMG for macOS, EXE for Windows, or APK for Android.','打开版本下载页，选择对应安装包：macOS 用 DMG，Windows 用 EXE，Android 用 APK。','リリースページで端末に合う形式を選びます。macOSはDMG、WindowsはEXE、AndroidはAPKです。','Öffne die Release-Seite: DMG für macOS, EXE für Windows oder APK für Android.'],
  ['On macOS, move LexiCue to Applications. On Windows, run the installer. On Android, install the APK with the permission required by your device.','macOS 将应用拖入“应用程序”；Windows 运行安装程序；Android 按设备提示授予安装权限后安装 APK。','macOSではアプリを「アプリケーション」へ移動します。Windowsではインストーラーを実行し、Androidでは端末の許可を確認してAPKをインストールします。','Verschiebe die App unter macOS nach „Programme“. Starte unter Windows den Installer; erlaube unter Android die APK-Installation gemäß den Hinweisen des Geräts.'],
  ['Launch the app. If the operating system blocks an unsigned package, follow the installation guide.','启动应用。若系统拦截未签名安装包，请按安装指南处理。','アプリを起動します。未署名のパッケージがブロックされた場合は、インストール案内を確認してください。','Starte die App. Wird das unsignierte Paket blockiert, folge der Installationsanleitung.']
 ],{links:[['release'],['installation']]}),
 section('first-file',['Import your first subtitles','导入第一份字幕','最初の字幕を取り込む','Die ersten Untertitel importieren'],[],[
  ['In Files, choose Import and select an SRT subtitle file.','在“文件”页点击导入，选择一份 SRT 字幕。','「ファイル」で取り込みを選び、SRT字幕を指定します。','Wähle unter „Dateien“ den Import und eine SRT-Datei.'],
  ['Check the content preview and learning language, then confirm the import.','检查内容预览和学习语言，确认导入。','内容のプレビューと学習言語を確認し、取り込みを確定します。','Prüfe Vorschau und Lernsprache und bestätige den Import.'],
  ['Open the new file from the library.','从文件库打开刚导入的文件。','ライブラリから取り込んだファイルを開きます。','Öffne die neue Datei in der Bibliothek.']
 ],{related:['files']}),
 section('first-review',['Look up and review a word','查词并完成一次复习','単語を調べて復習する','Ein Wort nachschlagen und wiederholen'],[],[
  ['Click a word in its sentence to open the definition.','点击原句中的单词，查看释义。','文中の単語を選び、語釈を確認します。','Klicke auf ein Wort im Satz, um seine Bedeutung zu sehen.'],
  ['Mark a word you want to remember as Learning.','将想记住的词标为“学习中”。','覚えたい単語を「学習中」にします。','Markiere ein Wort, das du lernen möchtest, als „Lernt“.'],
  ['Open Review, recall the meaning, reveal the answer and rate your recall.','进入“复习”，回忆含义、显示答案，再按记忆程度评分。','「復習」で意味を思い出し、答えを表示して記憶を評価します。','Öffne „Wiederholen“, erinnere dich an die Bedeutung, zeige die Antwort und bewerte deine Erinnerung.']
 ],{related:['reading','review']})
]);
add('files',
 ['Import SRT subtitles and organize them with tags. The learning-language filter determines which files appear.','导入 SRT 字幕，用标签整理文件。学习语言筛选决定当前显示哪些文件。','SRT字幕を取り込み、タグで整理します。表示されるファイルは学習言語で絞り込まれます。','Importiere SRT-Untertitel und ordne sie mit Tags. Die Lernsprache bestimmt, welche Dateien angezeigt werden.'],[
 section('import',['Import an SRT file','导入 SRT 文件','SRTファイルを取り込む','Eine SRT-Datei importieren'],[],[
  ['Choose Import in Files and select the subtitle file.','在“文件”页选择导入，并选中字幕文件。','「ファイル」で取り込みを選び、字幕ファイルを指定します。','Wähle in „Dateien“ den Import und die Untertiteldatei.'],
  ['Check the subtitle preview. Set the language you will learn; this is separate from the interface language.','检查字幕预览，选择要学习的语言；它与界面语言不同。','字幕を確認し、学習する言語を選びます。表示言語とは別の設定です。','Prüfe die Untertitel und wähle die Lernsprache. Sie ist von der Sprache der Oberfläche unabhängig.'],
  ['Select tags if needed and confirm. Open the resulting file card to read.','按需选择标签并确认，点击生成的文件卡片开始阅读。','必要ならタグを選んで確定します。作成されたファイルカードから読み始めます。','Wähle bei Bedarf Tags und bestätige. Öffne die neue Dateikarte zum Lesen.']
 ]),
 section('tags',['Organize and filter with tags','用标签整理与筛选','タグで整理・絞り込み','Mit Tags ordnen und filtern'],[
  ['Selecting several tags shows files that match all selected tags. Deleting a tag removes its assignments, not the files.','选择多个标签时，只显示同时匹配全部标签的文件。删除标签会移除标签关联，不会删除文件。','複数タグを選ぶと、すべてに一致するファイルだけが表示されます。タグを削除してもファイルは削除されません。','Mehrere ausgewählte Tags zeigen nur Dateien, die alle Tags besitzen. Das Löschen eines Tags entfernt die Zuordnung, nicht die Dateien.']
 ],[
  ['Open tag management to create, rename or delete a tag.','打开标签管理，创建、重命名或删除标签。','タグ管理で作成・名前変更・削除を行います。','Öffne die Tag-Verwaltung, um Tags anzulegen, umzubenennen oder zu löschen.'],
  ['Use a file’s tag editor to assign tags, then save.','在文件的标签编辑入口分配标签，保存修改。','ファイルのタグ編集からタグを付け、保存します。','Ordne Tags im Tag-Editor der Datei zu und speichere.'],
  ['Select tags to filter, choose Untagged to find files without tags, or clear the filter to see all files in the current language.','点击标签进行筛选；选择“无标签”找未分类文件；清除筛选可查看当前语言的全部文件。','タグで絞り込みます。「タグなし」で未分類のファイルを探し、解除すると現在の学習言語の全ファイルが表示されます。','Filtere nach Tags oder nach Dateien ohne Tags. Entferne den Filter, um alle Dateien der aktuellen Lernsprache zu sehen.']
 ],{image:'files'}),
 section('youtube',['Get YouTube subtitles','获取 YouTube 字幕','YouTubeの字幕を取得する','YouTube-Untertitel abrufen'],[
  ['This is an online subtitle source, not a file format. Available subtitles and tool requirements depend on the video and platform.','这是联网获取字幕的来源入口，不是文件格式。字幕是否可用及所需工具取决于视频和平台。','これはオンラインの字幕取得元であり、ファイル形式ではありません。字幕の有無や必要なツールは動画と環境によって異なります。','Dies ist eine Online-Quelle für Untertitel, kein Dateiformat. Verfügbarkeit und benötigte Werkzeuge hängen vom Video und der Plattform ab.']
 ],[
  ['Open the YouTube entry in Files and provide the video link.','在“文件”页打开 YouTube 入口，填写视频链接。','「ファイル」のYouTube入口から動画URLを入力します。','Öffne den YouTube-Zugang unter „Dateien“ und gib den Videolink ein.'],
  ['Follow the available subtitle selection and preview, then confirm the learning language and import.','按界面选择可用字幕并预览，确认学习语言后导入。','利用できる字幕を選んで確認し、学習言語を指定して取り込みます。','Wähle verfügbare Untertitel, prüfe die Vorschau und bestätige Lernsprache und Import.']
 ],{related:['settings#youtube']}),
 section('backup',['Back up and restore','备份与恢复','バックアップと復元','Sichern und wiederherstellen'],[],[
  ['Open the file menu and export a backup. Keep the exported file in a safe location.','打开文件菜单，导出备份，将备份文件妥善保存。','ファイルメニューからバックアップを書き出し、安全な場所に保存します。','Exportiere im Dateimenü eine Sicherung und bewahre die Datei sicher auf.'],
  ['To restore, choose the restore entry, select a LexiCue backup and read the confirmation before proceeding.','需要恢复时，选择恢复入口和 LexiCue 备份，阅读确认提示后继续。','復元時は復元入口でLexiCueのバックアップを選び、確認内容を読んでから進めます。','Wähle zum Wiederherstellen eine LexiCue-Sicherung und lies die Bestätigung, bevor du fortfährst.']
 ],{related:['faq#backup']})
]);
add('reading',
 ['Read subtitles and look up words without leaving their context. Definitions open in a drawer that you can close to continue reading.','边读字幕，边在原句中查词。释义在抽屉中打开，关闭即可继续阅读。','字幕を読みながら、元の文で単語を調べられます。語釈のドロワーを閉じれば、そのまま読み続けられます。','Lies Untertitel und schlage Wörter im Kontext nach. Schließe das Definitionsfenster, um weiterzulesen.'],[
 section('lookup',['Look up a word','点击查词','単語を調べる','Ein Wort nachschlagen'],[],[
  ['Open a file and click a word in a subtitle line.','打开文件，点击字幕行中的单词。','ファイルを開き、字幕の単語を選びます。','Öffne eine Datei und klicke auf ein Wort in einer Untertitelzeile.'],
  ['Read the definition and original sentence. The drawer opens on the right on desktop and from the bottom on mobile.','查看释义与原句。桌面端从右侧打开抽屉，手机从底部打开。','語釈と元の文を確認します。デスクトップでは右側、モバイルでは下から開きます。','Lies Bedeutung und Originalsatz. Auf dem Desktop öffnet sich das Fenster rechts, auf dem Handy von unten.'],
  ['Close the drawer to continue. If no definition is available, check the learning language and dictionary settings.','关闭抽屉继续阅读。若没有释义，请检查学习语言与词典设置。','閉じて読み続けます。語釈がない場合は学習言語と辞書設定を確認してください。','Schließe das Fenster und lies weiter. Fehlt eine Definition, prüfe Lernsprache und Wörterbucheinstellungen.']
 ],{image:'reading',related:['settings#dictionary']}),
 section('status',['Set a learning status','标记学习状态','学習状態を変更する','Den Lernstatus ändern'],[
  ['Use Learning for words you want to review, Known for words you already understand, and Skipped for entries you do not want to study. Unprocessed means you have not decided yet.','想复习的词标为“学习中”，已经理解的词标为“已掌握”，不准备学习的词可忽略；“未处理”表示尚未标注。','復習したい語は「学習中」、理解している語は「既知」、学習しない項目は「スキップ」にします。「未処理」は未分類です。','Markiere zu lernende Wörter als in Bearbeitung, bekannte Wörter als bekannt und nicht benötigte Einträge als ignoriert. Unbearbeitet bedeutet noch nicht eingeordnet.']
 ],[
  ['Open the word and change its status.','打开单词详情，修改学习状态。','単語の詳細で学習状態を変更します。','Öffne die Wortdetails und ändere den Status.'],
  ['The same status is reflected in Vocabulary and Insights.','修改会同步反映在“词汇”和“统计”中。','変更は「単語」と学習記録にも反映されます。','Die Änderung erscheint auch im Wortschatz und in der Statistik.']
 ]),
 section('analysis',['Understand context and phrases','理解语境与词组','文脈とフレーズを理解する','Kontext und Wendungen verstehen'],[
  ['AI is optional. Local Gemma needs a separate model download; a cloud provider needs your service configuration and sends the selected text to that service.','AI 为可选功能。本地 Gemma 需单独下载模型；云端提供方需配置服务，并会接收所选文本。','AIは任意です。ローカルGemmaにはモデルの追加取得が必要です。クラウドを使う場合は設定したサービスに選択したテキストが送信されます。','KI ist optional. Lokales Gemma benötigt einen separaten Modelldownload. Cloud-KI benötigt deine Dienstkonfiguration und erhält den ausgewählten Text.']
 ],[
  ['Configure and enable AI in Settings.','在“设置”中配置并开启 AI。','「設定」でAIを設定して有効にします。','Konfiguriere und aktiviere KI in den Einstellungen.'],
  ['Start analysis from the file or reading page and wait for its result.','从文件或阅读页主动启动分析，等待结果。','ファイルまたは読書画面から分析を開始し、結果を待ちます。','Starte die Analyse auf der Datei- oder Leseseite und warte auf das Ergebnis.'],
  ['Select a detected phrase to see its meaning and original context. Results depend on the language, model and content.','点击识别出的词组查看含义与原句。结果会随语言、模型和内容不同。','検出されたフレーズで意味と原文を確認します。結果は言語・モデル・内容によって変わります。','Wähle eine erkannte Wendung, um Bedeutung und Originalkontext zu sehen. Ergebnisse hängen von Sprache, Modell und Inhalt ab.']
 ],{related:['settings#ai','vocabulary']})
]);
add('vocabulary',
 ['Manage words and phrases collected from your subtitles. Each entry keeps its source so you can return to the original sentence.','整理从字幕中积累的单词与词组。每个条目保留来源，方便回到原句。','字幕から集めた単語とフレーズを整理します。出典から元の文に戻れます。','Verwalte Wörter und Wendungen aus deinen Untertiteln. Über die Quelle kommst du zum Originalsatz zurück.'],[
 section('find',['Find an entry','查找词汇','項目を探す','Einen Eintrag finden'],[],[
  ['Open Vocabulary and choose Words or Phrases.','进入“词汇”，切换单词或词组。','単語一覧を開き、単語またはフレーズを選びます。','Öffne den Wortschatz und wähle Wörter oder Wendungen.'],
  ['Search for an entry or filter by learning status. Check the current learning language if an entry is missing.','输入关键词搜索，或按学习状态筛选。找不到条目时，也检查当前学习语言。','検索語を入力するか、学習状態で絞り込みます。見つからない場合は学習言語も確認してください。','Suche einen Eintrag oder filtere nach Lernstatus. Prüfe bei fehlenden Einträgen auch die Lernsprache.']
 ],{image:'vocabulary'}),
 section('organize',['Change a status','调整学习状态','学習状態を変える','Einen Status ändern'],[],[
  ['Open an entry and choose the appropriate status. Use the selection tools when changing several entries.','打开条目后选择合适的状态；修改多个条目时使用列表的选择工具。','項目を開いて状態を選びます。複数を変更する場合は一覧の選択機能を使います。','Öffne einen Eintrag und wähle den passenden Status. Nutze die Auswahlwerkzeuge, um mehrere Einträge zu ändern.'],
  ['Words marked Learning become candidates for review; the scheduler determines when they are due.','标为“学习中”的词进入学习范围，是否到期由复习安排决定。','「学習中」の語は復習対象となり、予定に従って出題されます。','Wörter in Bearbeitung gehören zum Lernbestand; der Zeitplan bestimmt ihre Fälligkeit.']
 ],{related:['review']}),
 section('source',['Return to the original sentence','返回原句','元の文に戻る','Zum Originalsatz zurückkehren'],[],[
  ['Open the entry’s source or occurrence list.','打开条目的来源或出现位置列表。','項目の出典や出現箇所を開きます。','Öffne die Quellen oder Fundstellen des Eintrags.'],
  ['Choose a file and sentence to return to reading at that location.','选择文件与原句，返回对应位置继续阅读。','ファイルと文を選び、該当箇所から読み続けます。','Wähle Datei und Satz, um an dieser Stelle weiterzulesen.']
 ])
]);
add('review',
 ['Recall a word or phrase in its original sentence, then rate how well you remembered it. The app schedules the next review from your answer.','结合原句回忆单词或词组，再按记忆程度评分。应用据此安排下次复习。','元の文で単語やフレーズを思い出し、記憶を評価します。回答から次の復習が予定されます。','Erinnere dich an Wörter oder Wendungen im Originalsatz und bewerte deine Erinnerung. Daraus entsteht der nächste Wiederholungstermin.'],[
 section('session',['Complete a review','完成一次复习','復習する','Eine Wiederholung durchführen'],[],[
  ['Open Review and read the current card. Try to recall the meaning before revealing the answer.','进入“复习”，先看当前卡片，尝试回忆含义。','「復習」でカードを読み、答えを見る前に意味を思い出します。','Öffne „Wiederholen“ und versuche, dich vor dem Aufdecken an die Bedeutung zu erinnern.'],
  ['Reveal the answer and compare it with what you remembered.','显示答案，与自己的回忆对照。','答えを表示して、自分の記憶と比べます。','Zeige die Antwort und vergleiche sie mit deiner Erinnerung.'],
  ['Choose a rating and move to the next card. The rating is saved in the review record.','选择评分，进入下一张；本次评分会写入复习记录。','評価して次のカードに進みます。評価は復習記録に保存されます。','Wähle eine Bewertung und gehe zur nächsten Karte. Die Bewertung wird gespeichert.']
 ],{image:'review'}),
 section('ratings',['Choose an honest rating','如何选择评分','評価の選び方','Die passende Bewertung wählen'],[
  ['Forgot: you could not recall it. Hard: you recalled it with difficulty. Recalled: you recalled it correctly. Easy: you recalled it quickly and confidently.','忘记：没想起来。困难：勉强想起来。记得：正确回忆。简单：迅速且有把握地想起来。','忘れた：思い出せない。難しい：苦労して思い出した。覚えている：正しく思い出した。簡単：すぐ確信を持って思い出した。','Vergessen: nicht erinnert. Schwer: nur mit Mühe erinnert. Erinnert: richtig erinnert. Leicht: schnell und sicher erinnert.'],
  ['The displayed next-review time depends on this card’s history and your rating. It is not a fixed interval or a push notification.','显示的下次复习时间取决于该卡片的历史与本次评分，不是固定间隔，也不是推送通知。','次回の時刻はカードの履歴と評価によって変わります。固定間隔やプッシュ通知ではありません。','Der nächste Termin hängt von Kartenverlauf und Bewertung ab. Er ist weder ein festes Intervall noch eine Push-Benachrichtigung.']
 ]),
 section('baseline-check',['Check familiar frequency words','抽查高频已知词','既知の頻出語を確認する','Bekannte häufige Wörter prüfen'],[
  ['If you enabled a frequency baseline, reviews can include checks of those familiar words. The baseline currently supports English and Chinese.','启用高频词起步后，复习可包含对这些已知词的抽查。高频词目前支持英语与中文。','頻出語の初期設定を使うと、既知語の確認も復習に含まれます。現在は英語と中国語に対応しています。','Bei aktivierter Häufigkeitsgrundlage können bekannte Wörter zur Prüfung erscheinen. Derzeit werden Englisch und Chinesisch unterstützt.']
 ],[],{related:['settings#frequency-baseline']})
]);
add('insights',
 ['Use learning states, review history and file progress to decide what to study next. These indicators summarize activity, not a language-proficiency score.','通过学习状态、复习记录和文件进度，决定下一步学什么。这些指标反映学习活动，不是语言水平评分。','学習状態、復習記録、ファイルの進捗から次に学ぶ内容を選べます。語学力を採点する指標ではありません。','Nutze Lernstatus, Wiederholungsverlauf und Dateifortschritt für deine nächste Lerneinheit. Die Werte beschreiben Aktivität, keine Sprachkompetenz.'],[
 section('states',['Word and phrase states','单词与词组状态','単語とフレーズの状態','Status von Wörtern und Wendungen'],[
  ['The counts distinguish Unprocessed, Learning, Known and Skipped entries. Words and phrases are summarized separately.','数量分别统计未处理、学习中、已掌握和已跳过的条目，单词与词组分开汇总。','未処理・学習中・既知・スキップを別々に数え、単語とフレーズを分けて表示します。','Die Zahlen unterscheiden unbearbeitete, lernende, bekannte und übersprungene Einträge. Wörter und Wendungen werden getrennt ausgewertet.']
 ],[],{image:'insights'}),
 section('history',['Recent reviews','近期复习','最近の復習','Letzte Wiederholungen'],[
  ['The seven-day chart shows recent review activity. It changes when reviews are recorded; it does not mean every word was mastered.','七日图表显示近期复习活动，完成复习后更新；复习次数不代表掌握词数。','7日間の図は最近の復習活動を示します。復習の記録で更新されますが、回数は習得語数ではありません。','Das Sieben-Tage-Diagramm zeigt Wiederholungsaktivität. Es wird durch gespeicherte Bewertungen aktualisiert; die Anzahl entspricht nicht der Zahl beherrschter Wörter.']
 ]),
 section('files',['File learning progress','文件学习进度','ファイルの学習進捗','Lernfortschritt je Datei'],[
  ['The learning index combines entry states: Known and Skipped count fully, Learning counts halfway, and Unprocessed counts as zero.','学习指数综合条目状态：已掌握与已跳过计入全部权重，学习中计入一半，未处理计为零。','学習指数では、既知・スキップを全量、学習中を半分、未処理をゼロとして集計します。','Der Lernindex gewichtet bekannte und übersprungene Einträge vollständig, lernende zur Hälfte und unbearbeitete mit null.']
 ],[
  ['Find a file in Insights and open its progress entry to continue reading.','在“统计”中找到文件，点击进度入口继续阅读。','学習記録のファイル別進捗から、読み続けたいファイルを開きます。','Öffne den Fortschrittseintrag einer Datei in der Statistik, um weiterzulesen.']
 ])
]);
add('settings',
 ['Configure the installed app here. Optional online features are separate from local reading, lookup and review.','这里介绍安装版的设置。可选联网功能与本地阅读、查词和复习分别配置。','インストール版の設定を説明します。任意のオンライン機能はローカルの読書・辞書・復習とは別に設定します。','Hier findest du die Einstellungen der installierten App. Optionale Online-Funktionen werden getrennt vom lokalen Lesen, Nachschlagen und Wiederholen eingerichtet.'],[
 section('ui-language',['Interface language','界面语言','表示言語','Oberflächensprache'],[
  ['Choose English, Chinese, Japanese or German in Settings. This changes buttons and labels, not the language of your imported subtitles.','在设置中选择英语、中文、日语或德语。它改变按钮与界面文字，不改变字幕的学习语言。','設定で英語・中国語・日本語・ドイツ語を選びます。ボタンや表示文字が変わり、字幕の学習言語は変わりません。','Wähle Englisch, Chinesisch, Japanisch oder Deutsch. Das ändert Beschriftungen, nicht die Lernsprache deiner Untertitel.']
 ],[],{image:'settings'}),
 section('frequency-baseline',['Frequency baseline','高频词起步','頻出語の初期設定','Häufige Wörter als Grundlage'],[],[
  ['Expand the frequency section and choose English or Chinese.','展开高频词设置，选择英语或中文。','頻出語の設定を開き、英語または中国語を選びます。','Öffne die Häufigkeitseinstellung und wähle Englisch oder Chinesisch.'],
  ['Choose a range from 1,000 to 10,000 words, preview it and apply the range you already know.','选择 1,000 至 10,000 词的范围，预览后应用自己已经熟悉的范围。','1,000〜10,000語の範囲を選び、確認して既知の範囲を適用します。','Wähle einen Bereich von 1.000 bis 10.000 Wörtern, prüfe die Vorschau und übernimm den Bereich, den du bereits kennst.'],
  ['Use the undo entry if you want to withdraw the baseline; read its confirmation before proceeding.','需要撤销时使用撤销入口，先阅读确认提示。','取り消す場合は取り消し操作の確認内容を読んで進めます。','Nutze bei Bedarf die Rücknahme und lies vorher die Bestätigung.']
 ]),
 section('cloud-sync',['Cloud sync','云同步','クラウド同期','Cloud-Synchronisierung'],[
  ['Sync is optional and needs an internet connection. Learning records are encrypted before transfer; keep the recovery code when it is issued.','同步为可选联网功能。学习记录加密后传输；生成恢复码时请妥善保存。','同期は任意で、ネット接続が必要です。学習記録は転送前に暗号化されます。発行された復旧コードを保管してください。','Die Synchronisierung ist optional und benötigt Internet. Lernaufzeichnungen werden vor der Übertragung verschlüsselt; bewahre den ausgegebenen Wiederherstellungscode auf.']
 ],[
  ['Expand Cloud sync and register or sign in.','展开云同步，注册或登录账号。','クラウド同期を開き、登録またはログインします。','Öffne die Cloud-Synchronisierung und registriere dich oder melde dich an.'],
  ['Use the same account on your other device, then synchronize and inspect the status. Automatic sync can be enabled separately.','在另一台设备使用同一账号，再执行同步并检查状态；自动同步可以单独开启。','別の端末でも同じアカウントを使い、同期後の状態を確認します。自動同期は別途有効にできます。','Verwende auf dem anderen Gerät dasselbe Konto, synchronisiere und prüfe den Status. Automatische Synchronisierung lässt sich gesondert aktivieren.']
 ],{related:['files#backup']}),
 section('ai',['AI analysis','AI 分析','AI分析','KI-Analyse'],[],[
  ['Enable AI and choose local Gemma or a cloud API.','开启 AI，选择本地 Gemma 或云端 API。','AIを有効にし、ローカルGemmaまたはクラウドAPIを選びます。','Aktiviere KI und wähle lokales Gemma oder eine Cloud-API.'],
  ['For local AI, download or import a compatible model and select it. Model download needs internet; local inference works after the model is ready.','本地 AI 需下载或导入兼容模型并选用。下载模型需要联网，准备完成后可本地推理。','ローカルAIは対応モデルを取得または取り込み、選択します。取得にはネットが必要ですが、準備後の推論はローカルで動作します。','Lade für lokale KI ein kompatibles Modell herunter oder importiere es und wähle es aus. Der Download benötigt Internet; danach läuft die Inferenz lokal.'],
  ['For cloud AI, configure the service address, your API key and model, then check the connection. Selected text is sent to that provider.','云端 AI 需配置服务地址、自己的 API 密钥与模型，再检查连接。所选文本会发送给该提供方。','クラウドAIではサービスのURL、APIキー、モデルを設定し、接続を確認します。選択したテキストはその提供元に送信されます。','Konfiguriere für Cloud-KI Dienstadresse, eigenen API-Schlüssel und Modell und prüfe die Verbindung. Ausgewählter Text wird an diesen Anbieter gesendet.']
 ],{related:['reading#analysis']}),
 section('youtube',['YouTube import','YouTube 导入','YouTube取り込み','YouTube-Import'],[
  ['Check the tool status in this section. Desktop setup can require yt-dlp and its runtime dependencies; follow the platform-specific instructions shown by the app.','在此检查工具状态。桌面环境可能需要 yt-dlp 及其运行依赖，按应用显示的平台说明配置。','ここでツールの状態を確認します。デスクトップではyt-dlpと実行環境が必要になるため、アプリの環境別案内に従ってください。','Prüfe hier den Werkzeugstatus. Auf dem Desktop können yt-dlp und Laufzeitabhängigkeiten nötig sein; folge den Plattformhinweisen der App.'],
  ['Browser-session options are optional and depend on the platform. Use them only when the source requires an authenticated session.','浏览器会话选项为可选功能，并受平台限制；仅在来源需要登录状态时使用。','ブラウザセッションは任意で、環境によって利用可否が異なります。取得元がログインを要求する場合にだけ使用します。','Browser-Sitzungen sind optional und plattformabhängig. Nutze sie nur, wenn die Quelle eine angemeldete Sitzung erfordert.']
 ],[],{related:['files#youtube']}),
 section('theme',['Theme','主题','テーマ','Thema'],[
  ['Choose ocean, sage, twilight, amber or midnight. The theme changes the app’s appearance without changing learning data.','可选择 ocean、sage、twilight、amber 或 midnight。主题只改变外观，不改变学习数据。','ocean・sage・twilight・amber・midnightを選べます。外観だけが変わり、学習データは変わりません。','Wähle ocean, sage, twilight, amber oder midnight. Das Thema ändert die Darstellung, nicht deine Lerndaten.']
 ]),
 section('dictionary',['Dictionaries','词典管理','辞書管理','Wörterbücher'],[],[
  ['Expand Dictionaries to inspect installed sources and supported languages.','展开词典管理，查看已安装来源与支持语言。','辞書管理でインストール済みの出典と対応言語を確認します。','Öffne die Wörterbuchverwaltung und prüfe installierte Quellen und Sprachen.'],
  ['Import a compatible dictionary pack when needed. Removing an imported source changes available definitions; read the deletion confirmation.','按需导入兼容词典包。移除导入来源会影响可用释义，请阅读删除确认提示。','必要なら対応辞書パックを取り込みます。出典を削除すると利用できる語釈が変わるため、確認内容を読んでください。','Importiere bei Bedarf ein kompatibles Wörterbuchpaket. Das Entfernen einer Quelle verändert verfügbare Definitionen; lies die Löschbestätigung.']
 ]),
 section('storage',['Storage','存储','ストレージ','Speicher'],[
  ['Expand Storage to see the space used by app data and its components. Export a backup before making destructive changes to your library.','展开存储查看应用数据及各部分占用。对资料库进行删除等操作前，先导出备份。','ストレージでデータと各項目の使用量を確認します。ライブラリの削除などを行う前にバックアップしてください。','Öffne den Speicherbereich, um die Belegung der Daten und Komponenten zu sehen. Sichere die Bibliothek vor Löschaktionen.']
 ],[],{related:['files#backup']}),
 section('updates',['App updates','应用更新','アプリの更新','App-Updates'],[
  ['Check for updates in Settings. When an update is available, follow the installation or download action offered on your platform.','在设置中检查更新。发现新版本后，按当前平台提供的安装或下载入口操作。','設定で更新を確認します。新しい版がある場合は、環境に応じて表示されるインストールまたはダウンロードを選びます。','Prüfe in den Einstellungen auf Updates. Folge bei einer neuen Version der auf deiner Plattform angebotenen Installation oder dem Download.']
 ],[],{links:[['release']]})
]);
add('faq',
 ['Short answers to common installation and learning questions. Follow the linked chapter for the operation itself.','这里回答常见的安装和学习问题，具体操作可查看对应章节。','導入と学習でよくある質問に短く答えます。操作手順は関連する章を確認してください。','Kurze Antworten auf häufige Installations- und Lernfragen. Die Schritte findest du im jeweiligen Kapitel.'],[
 section('installation',['The app will not open after installation','安装后打不开怎么办？','インストール後に開けない場合','Die App öffnet sich nach der Installation nicht'],[
  ['Current packages are unsigned. macOS, Windows and Android may show different security prompts. Use the official release and follow the instructions for your platform.','当前安装包未签名，macOS、Windows 和 Android 的提示不同。请使用官方版本，并按对应平台的安装说明处理。','現在のパッケージは未署名で、macOS・Windows・Androidの警告は異なります。公式リリースを使い、環境別の案内を確認してください。','Die Pakete sind derzeit unsigniert. macOS, Windows und Android zeigen unterschiedliche Hinweise. Nutze den offiziellen Release und die Anleitung deiner Plattform.']
 ],[],{links:[['installation']]}),
 section('srt',['Which files can I import?','可以导入什么文件？','取り込めるファイル形式は？','Welche Dateien kann ich importieren?'],[
  ['File import currently supports SRT subtitles. If an import fails, check that the file has numbered subtitle blocks, valid time ranges and subtitle text. Renaming an extension does not convert a file.','目前文件导入支持 SRT 字幕。导入失败时，检查文件是否包含字幕序号、有效时间范围与正文；修改扩展名不会转换文件内容。','現在のファイル取り込みはSRT字幕に対応しています。失敗した場合は字幕番号、正しい時間範囲、本文を確認してください。拡張子の変更だけでは変換されません。','Der Dateiimport unterstützt derzeit SRT-Untertitel. Prüfe bei Fehlern Nummern, gültige Zeitbereiche und Untertiteltext. Eine geänderte Dateiendung konvertiert die Datei nicht.']
 ],[],{related:['files#import']}),
 section('offline',['Can I study offline?','可以离线学习吗？','オフラインで学べますか？','Kann ich offline lernen?'],[
  ['Local reading, built-in dictionary lookup and review work offline. YouTube subtitle retrieval, model downloads, cloud AI and cloud sync need internet. Local AI works after a compatible model is ready.','本地阅读、内置词典查词和复习可离线使用。获取 YouTube 字幕、下载模型、云端 AI 和云同步需要联网；本地 AI 在兼容模型准备完成后运行。','ローカルの読書、内蔵辞書、復習はオフラインで使えます。YouTube字幕の取得、モデルの取得、クラウドAI、同期はネットが必要です。ローカルAIは対応モデルの準備後に使えます。','Lokales Lesen, integrierte Wörterbücher und Wiederholen funktionieren offline. YouTube-Abruf, Modelldownloads, Cloud-KI und Synchronisierung brauchen Internet. Lokale KI funktioniert nach Einrichtung eines kompatiblen Modells.']
 ]),
 section('lookup',['Why is a definition or AI result missing?','为什么没有释义或 AI 结果？','語釈やAI結果が表示されない場合','Warum fehlen eine Definition oder ein KI-Ergebnis?'],[
  ['Check the file’s learning language and the available dictionary sources. For AI, also check that it is enabled, a model is selected and the model or service is ready. Not every form or phrase has a result.','先检查文件学习语言与词典来源。AI 还需确认已开启、已选模型且模型或服务就绪；并非每种词形和词组都有结果。','ファイルの学習言語と辞書を確認します。AIは有効化、モデル選択、モデルまたはサービスの準備も確認してください。すべての語形やフレーズに結果があるとは限りません。','Prüfe Lernsprache und Wörterbuchquellen. Prüfe bei KI außerdem Aktivierung, Modellauswahl und Bereitschaft des Modells oder Dienstes. Nicht jede Wortform oder Wendung liefert ein Ergebnis.']
 ],[],{related:['settings#dictionary','settings#ai']}),
 section('review',['Why are there no cards to review?','为什么没有待复习卡片？','復習カードがない場合','Warum gibt es keine Wiederholungskarten?'],[
  ['Check the current learning language and whether entries are marked Learning. A card may not be due yet; the next interval depends on its history and your ratings.','检查当前学习语言，以及条目是否标为“学习中”。卡片可能尚未到期，下次间隔取决于历史与评分。','現在の学習言語と「学習中」の項目を確認します。カードがまだ期日でない場合もあり、次回の間隔は履歴と評価で決まります。','Prüfe Lernsprache und Einträge in Bearbeitung. Eine Karte kann noch nicht fällig sein; das Intervall hängt von Verlauf und Bewertungen ab.']
 ],[],{related:['review']}),
 section('backup',['Is sync the same as a backup?','同步和备份是一回事吗？','同期とバックアップは同じですか？','Sind Synchronisierung und Sicherung dasselbe?'],[
  ['No. A backup is an exported file you keep; sync carries learning records between connected devices. Export a backup before restoring or making major changes, and keep your sync recovery code separately.','不是。备份是自己保存的导出文件，同步用于设备间接续学习记录。恢复或大幅调整资料库前先备份，同步恢复码也应单独保存。','異なります。バックアップは保管する書き出しファイルで、同期は端末間で学習記録を引き継ぐ機能です。復元や大きな変更の前にバックアップし、復旧コードも別に保管してください。','Nein. Eine Sicherung ist eine exportierte Datei, die du aufbewahrst. Synchronisierung führt Lernaufzeichnungen zwischen Geräten weiter. Sichere vor Wiederherstellungen oder größeren Änderungen und bewahre den Wiederherstellungscode separat auf.']
 ],[],{related:['files#backup','settings#cloud-sync']})
]);
const localize=(value,index)=>Array.isArray(value)?value[index]:value;
export const manualContent=Object.fromEntries(locales.map((locale,index)=>[locale,Object.fromEntries(Object.entries(chapters).map(([id,chapter])=>[id,{
 intro:localize(chapter.intro,index),sections:chapter.sections.map(item=>({...item,title:localize(item.title,index),body:item.body.map(row=>localize(row,index)),steps:item.steps.map(row=>localize(row,index))}))
}]))]));
export const manualLabels=Object.fromEntries(locales.map((locale,index)=>[locale,{
 menu:localize(['Navigation','导航菜单','ナビゲーション','Navigation'],index),
 toc:localize(['On this page','本页目录','このページの目次','Auf dieser Seite'],index),
 enlarge:localize(['Enlarge screenshot','放大截图','画面を拡大','Screenshot vergrößern'],index),
 close:localize(['Close image','关闭图片','画像を閉じる','Bild schließen'],index),
 screenshot:localize(['Product interface · sample data','产品界面 · 样例数据','製品画面 · サンプルデータ','Produktoberfläche · Beispieldaten'],index),
 related:localize(['See also','相关操作','関連する操作','Siehe auch'],index),
 groups:[['Getting started','开始使用','はじめに','Einstieg'],['Learning and organizing','学习与整理','学習と整理','Lernen und ordnen'],['Configuration and help','配置与帮助','設定とヘルプ','Konfiguration und Hilfe']].map(row=>localize(row,index))
}]));
