"""Write the final Chinese delivery report only after actual package acceptance."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shlex
import sqlite3
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo

from build_local_package import sha256


def read(path):
    return json.loads(Path(path).read_text())


def size(value):
    return {"bytes": value, "MB_decimal": round(value / 1_000_000, 3), "MiB_binary": round(value / 1_048_576, 3)}


def describe(value):
    return f"{value:,} bytes = {value / 1_000_000:.2f} MB = {value / 1_048_576:.2f} MiB"


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--artifact-root',type=Path,required=True)
    p.add_argument('--project-root',type=Path,required=True)
    a=p.parse_args();root=a.artifact_root.resolve();project=a.project_root.resolve()
    text=root/'text-v1';audio=root/'audio-work/headword-audio'
    validation=read(root/'validation-v1/validation-results.json')
    assert validation['passed'] and validation['full_schema']['performed'], 'Full validation must finish and pass'
    assert validation['fixed_100']['passed']==100
    assert 'Ran 10 tests' in (root/'validation-v1-regression.log').read_text()
    assert '\nOK\n' in (root/'validation-v1-regression.log').read_text()
    protection=read(root/'source-and-workspace-protection.json')
    reproducibility=read(root/'reproducibility-results.json')
    assert protection['all_inputs_unchanged'] and protection['protected_workspace_files_unchanged']
    assert all(reproducibility[k] for k in ['counts_identical','logical_hash_identical','database_sha256_identical','file_manifest_identical'])
    zip_validation=read(root/'text-archive-validation.json')
    xz_validation=read(root/'text-xz-archive-validation.json')
    assert zip_validation['crc_passed'] and zip_validation['file_inventory_identical']
    assert xz_validation['passed']
    assert zip_validation['archive_sha256']==sha256(root/'longman6-text-v1.zip')
    assert xz_validation['archive_sha256']==sha256(root/'longman6-text-v1.tar.xz')
    manifest=read(text/'manifest.json');audio_manifest=read(audio/'manifest.json')
    files={}
    for label,path in [('text_database',text/'runtime.sqlite'),('text_manifest',text/'manifest.json'),
                       ('text_xz',root/'longman6-text-v1.tar.xz'),('text_zip',root/'longman6-text-v1.zip'),
                       ('audio_manifest',audio/'manifest.json'),('audio_zip',root/'audio-work/headword-audio.zip')]:
        files[label]={"path":str(path),"sha256":sha256(path),**size(path.stat().st_size)}
    installed_text=sum(x['bytes'] for x in manifest['files'])+(text/'manifest.json').stat().st_size
    installed_audio=sum(x['bytes'] for x in audio_manifest['files'])+(audio/'manifest.json').stat().st_size
    allocation={name:size(int(subprocess.check_output(['du','-sk',str(path)],text=True).split()[0])*1024)
                for name,path in [('text',text),('audio',audio)]}
    db=sqlite3.connect((text/'runtime.sqlite').as_uri()+'?mode=ro',uri=True)
    bilingual=db.execute('SELECT count(*) FROM senses WHERE bilingual_candidate=1').fetchone()[0]
    dated=db.execute("SELECT count(*) FROM senses WHERE flags_json LIKE '%dated_encyclopedic_reference%'").fetchone()[0]
    db.close()
    q=shlex.quote;query_script=text/'package_query.py';scriptdir=project/'scripts/dictionary_validation'
    commands={
        'query_text':f"python3 {q(str(query_script))} --package {q(str(text))} 'look it up' --validate",
        'query_audio':f"python3 {q(str(query_script))} --package {q(str(text))} --audio-package {q(str(audio))} record --validate",
        'query_only_stdlib':f"python3 {q(str(query_script))} --package {q(str(text))} 'took'",
        'validation':f"PYTHONPATH={q(str(text/'vendor')+':'+str(scriptdir))} python3 {q(str(scriptdir/'validate_local_package.py'))} --package {q(str(text))} --audio-package {q(str(audio))} --note-overlay {q(str(root/'note-bodies-v1.sqlite'))} --output /private/tmp/longman-v1-revalidation --schema-workers 4",
        'regressions':f"LONGMAN_PACKAGE={q(str(text))} PYTHONPATH={q(str(text/'vendor')+':'+str(scriptdir))} python3 -m unittest discover -s {q(str(scriptdir))} -p test_local_package.py -v",
    }
    reviewed=protection['input_fingerprints'][0]['path'];mdx=protection['input_fingerprints'][1]['path'];mdd=protection['input_fingerprints'][2]['path']
    commands['build_runtime']=f"python3 {q(str(scriptdir/'build_local_package.py'))} --reviewed {q(reviewed)} --metadata {q(str(root/'audio-work/metadata-final-v101.sqlite'))} --note-bodies {q(str(root/'note-bodies-v1.sqlite'))} --mdx {q(mdx)} --mdd {q(mdd)} --vendor {q(str(text/'vendor'))} --output /private/tmp/longman-v1-fresh-build --zip /private/tmp/longman-v1-fresh-build.zip --tar-xz /private/tmp/longman-v1-fresh-build.tar.xz"
    commands['build_metadata_audio']=f"python3 {q(str(scriptdir/'package_pronunciation.py'))} --reviewed-db {q(reviewed)} --mdx {q(mdx)} --mdd {q(mdd)} --output /private/tmp/longman-v1-fresh-audio"
    commands['build_note_overlay']=f"python3 {q(str(scriptdir/'package_notes.py'))} --reviewed {q(reviewed)} --mdx {q(mdx)} --output /private/tmp/longman-v1-fresh-notes.sqlite"
    limitations=[
        '固定100组中US、cost an arm and a leg仍仅英文，后者例句也无原中文；没有猜补译文。',
        'run out的1条待核实板球意思继续排除；用完、耗尽、到期等日常意思保留。',
        f'全库采用中文的意思{bilingual:,}条；其余{manifest["counts"]["senses"]-bilingual:,}条按英文范围保留（包含5条年代性原中文未默认采用），这是内容计数，不是准确率。',
        f'{dated:,}条年代性百科意思保留并返回dated_reference提示；没有全面更新百科或逐条人工审校。',
        '原MDX引用的14个词头发音在原MDD中缺失；有效安装包资源全部存在，缺失源音频在V1中返回null。',
        'record名词/动词英美4段均完整解码并核对来源；工具不支持模型音频输入，听感核查未完成，不能声称已抽听。',
        '59个源相关引用目标没有可用独立查询内容；保留不带MDX锚点的源查询链接，可返回not_found，不拿母词意思替代。',
        '查询保留大小写和标点身份；仅支持来源明确的词形、变体和可分表达规则，未做任意纠错或任意短语语义识别。',
        '未导出例句音频/图片；未修改产品UI、保存流程或默认词典；未接剑桥、做安装器、commit、push或发布资源。',
        '严格模式首次加载完整发音包会逐文件校验全部SHA256，启动较慢；批量查询复用已打开实例，不能把逐文件校验耗时当成单次查词耗时。',
    ]
    changes=[
        '恢复原MDX词条/词性分组，分离record名词/动词与同词性多个原有分组；不按拼写+词性合并发音。',
        '词头变体、词形发音保留明确form_label，修复pre-nup、hurray/hurrah、tell/told、turf/turves等归属；内嵌表达不借母词发音。',
        '从同一原书说明块恢复3010条旧数组为空的正文；按原始字符位置投影已审正文修改，例句仍取已审视图，避免跨句替换。',
        'calm down使用源词头明确的完整变体，限制到适用动词意思；表达不继承母词词性/发音。',
        'look it up/looked the word up仅查资料义；turned it off按原可分结构限制范围，完整look up数据不被收窄覆盖。',
        '词形/拼写变体同时保留形式条目和规范词头；默认选择已有中文的规范内容。',
        '修复全包检查查出的省略号NFKC匹配遗漏，…与...按同一来源规范形式命中，仍保留原书词头。',
        '相关引用转成来源支持的新查询，清除原MDX内部锚点；不把引用当成同义释义。',
        f"{sum(len(x['relocated_example_ids']) for x in validation['fixed_100']['queries'])}条样例在{sum(bool(x['relocated_example_ids']) for x in validation['fixed_100']['queries'])}组查询中改用同义项下的来源句型例句标识；英文、中文及所属意思逐条相同，旧→新标识映射已记录。",
    ]
    report={
        'schema_version':1,'generated_at':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
        'release':manifest['data_release'],'builder_version':manifest['builder_version'],
        'conclusion':{'text_package':'passed','audio_package_engineering':'passed_with_14_source_absences',
                      'audio_perceptual_listening':'not_performed_tool_does_not_support_audio_input',
                      'ready_for_next_page_integration':True,'entire_book_linguistically_certified':False},
        'artifact_root':str(root),'files':files,'content_counts':manifest['counts'],
        'bilingual_adopted_senses':bilingual,'english_only_adopted_senses':manifest['counts']['senses']-bilingual,
        'sizes':{'text_installed_content':size(installed_text),'audio_installed_content':size(installed_audio),
                 'combined_installed_content':size(installed_text+installed_audio),
                 'combined_download_xz_audio_zip':size(files['text_xz']['bytes']+files['audio_zip']['bytes']),
                 'combined_download_zip_audio_zip':size(files['text_zip']['bytes']+files['audio_zip']['bytes']),
                 'measured_filesystem_allocation':allocation},
        'validation':validation,'regressions':{'passed':10,'total':10,'log':str(root/'validation-v1-regression.log')},
        'source_protection':protection,'runtime_reproducibility':reproducibility,
        'metadata_reproducibility':read(root/'audio-repro/metadata-reproducibility.json'),
        'audio_source_absences':audio_manifest['issues'],'audio_evidence_paths':[
            str(root/'audio-work/audio-package-validation.json'),str(root/'audio-work/metadata-final-validation.json'),
            str(root/'audio-work/source-metadata-regressions.json'),str(root/'audio-work/validation-samples/audio-decode-evidence.json')],
        'cold_start_measurement':read(root/'cold-query-timings.json'),
        'note_overlay':{'path':str(root/'note-bodies-v1.sqlite'),'summary':read(root/'note-bodies-v1.json')},
        'changes':changes,'limitations':limitations,'commands':commands,
        'source_programs':[{ 'path':str(scriptdir/name),'sha256':sha256(scriptdir/name)} for name in
            ['build_local_package.py','package_pronunciation.py','package_notes.py','package_query.py','package_semantics.py','validate_local_package.py','test_local_package.py','report_local_package.py']],
        'schema_modified':False,
    }
    destination=project/'docs/implementation';destination.mkdir(exist_ok=True)
    (destination/'longman-local-package-validation-v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    passed=lambda x:f"{sum(v['passed'] for v in x)}/{len(x)}"
    lines=[
        '朗文6本地词典包与快速核查交付报告 V1',report['generated_at'],'',
        '结论：完整文字/音标包通过，可进入下一步页面接入。配套词头发音包工程校验通过，14个源资源缺失如实返回null；听感核查受工具限制未完成，不能把音频全部验收说成通过。',
        '本轮未切换运行中词典，也未修改界面或个人数据。Schema未改动。',
        f"发布号：{manifest['data_release']}；构建程序：{manifest['builder_version']}。",'',
        '一、实测体积与交付路径',
        f'文字/音标包：{text}',f'安装内容：{describe(installed_text)}',
        f"文字XZ：{files['text_xz']['path']}\n{describe(files['text_xz']['bytes'])}",
        f"文字ZIP：{files['text_zip']['path']}\n{describe(files['text_zip']['bytes'])}",
        f'发音包：{audio}',f'安装内容：{describe(installed_audio)}',
        f"发音ZIP：{files['audio_zip']['path']}\n{describe(files['audio_zip']['bytes'])}",
        f'文字+发音安装内容合计：{describe(installed_text+installed_audio)}',
        f"XZ文字+ZIP发音下载合计：{describe(files['text_xz']['bytes']+files['audio_zip']['bytes'])}",
        'MB=1,000,000字节；MiB=1,048,576字节。安装内容按所有交付文件长度求和，包含manifest和随包校验器；不是审校数据库体积。',
        f"本机du实际磁盘分配：文字{describe(allocation['text']['bytes'])}；发音{describe(allocation['audio']['bytes'])}。小音频文件较多，文件系统分配大于内容长度，其他文件系统会不同。",
        '先前30–40MB只是精简试算，本轮完整来源分组、必要语义、例句和索引实测高于该值；没有裁掉大量内容来迎合估算。','',
        '二、内容与完整性',
        '\n'.join(f'{k}: {v:,}' for k,v in manifest['counts'].items()),
        f'采用中文的意思{bilingual:,}条；英文范围{manifest["counts"]["senses"]-bilingual:,}条。待核实板球义1条排除。',
        '文字查询不依赖源MDX/MDD、审校库、网络或开发机绝对路径。来源记录号/XPath及稳定ID在包内；开发机reference.path已去掉，来源指纹/记录/外部依据保留。',
        '原书多分组与同词性多分组保留；两条旧版恢复释义原无definition_xpath，以已有scope_xpath定位，不伪造原书叶节点。',
        '3010条说明正文按原块恢复，104条去重后的可展示inline hint保留；元数据原提取121条含重复出处。','',
        '三、验证结果',
        f"固定100组：{validation['fixed_100']['passed']}/100；found={validation['fixed_100']['found']}，partial={validation['fixed_100']['partial']}；原样例{validation['fixed_100']['reviewed_examples_compared']}句全部对应。",
        f"全包自动结构/来源/资源检查：{passed(validation['static_checks'])}；边界：{passed(validation['boundary_checks'])}；有意义回归10/10。",
        f"真实Draft202012 Schema遍历{validation['full_schema']['queries']:,}组查询，失败{len(validation['full_schema']['failures'])}；覆盖全部{validation['full_schema']['expected_runtime_senses']:,}条运行时意思，未覆盖{len(validation['full_schema']['missing_runtime_senses'])}。",
        '独立复制文字包到新临时目录，仅传包路径，阻止网络和原MDX/MDD/审校库访问：6组查询及Schema/语义验证通过。',
        '发音91626个MP3文件的SHA256、大小、包内相对路径及ZIP CRC全部通过；14个缺失源文件单列。record名词/动词英美4段完整解码通过，未完成主观听感核查。',
        '重复运行元数据提取与运行时构建：逻辑ID、表内容、统计一致；最终元数据及运行时数据库逐字节一致。压缩包时间戳固定，归档内容逐文件校验。',
        f"固定100组热进程查询中位数{validation['latency']['median_ms']:.3f}ms，P95 {validation['latency']['p95_ms']:.3f}ms。不含Schema/来源核对和JSON输出序列化。环境详见JSON报告。",
        f"严格首次加载含全部文件校验：文字约{report['cold_start_measurement']['initialization_including_full_checksums'][0]['manifest_and_database_validation_seconds']:.2f}秒，含发音约{report['cold_start_measurement']['initialization_including_full_checksums'][1]['manifest_and_database_validation_seconds']:.2f}秒；这是完整SHA校验测量，后续页面接入应复用已打开实例，并在安装验证后安排校验策略。本轮不做安装器。",
        '98/100仅为固定日常样本的中文覆盖结果，不代表整本98%准确率，也没有重开全书逐条人工审读。','',
        '四、明显问题修复与表示变化',*changes,'',
        '五、已知限制和未完成项',*limitations,'',
        '六、校验和（SHA-256）',*['%s\n%s'%(v['path'],v['sha256']) for v in files.values()],
        '输入文件：',*[f"{v['path']}\n{v['bytes']} bytes\n{v['sha256']}\n本轮未变更={v['unchanged']}" for v in protection['input_fingerprints']],
        f"原有29个已修改受保护工程文件指纹全部一致：{protection['protected_workspace_files_unchanged']}。既有未跟踪文件未覆盖；新增源码均为本轮专用文件。",'',
        '七、独立查询、重建和复测命令',
        '运行时Python3.10+；普通查询只用标准库；--validate使用包内纯Python jsonschema4.17.3/attrs24.2.0/pyrsistent0.20.0，不依赖编译扩展或网络。',
        '从源提取元数据/音频或说明覆盖层，需要工程requirements中的readmdict/lxml；运行时不需要这些构建依赖。以下输出目录必须是新目录。',
        *[f'{k}:\n{v}' for k,v in commands.items()],'',
        '八、逐组固定100查询结果',
        *[f"{v['index']:03}. {v['query']} — {v['status']} / {'通过' if v['passed'] else '未通过'}；{v['baseline_note']}" for v in validation['fixed_100']['queries']],
        '', '九、详细证据',
        str(root/'validation-v1/validation-results.json'),str(root/'validation-v1/fixed100-v1-results.json'),
        str(root/'validation-v1/boundary-v1-results.json'),str(root/'validation-v1/100组离线查询核查.txt'),
        str(root/'validation-v1/代表性离线查询输出.txt'),str(root/'audio-repro/metadata-reproducibility.json'),
        str(root/'note-bodies-v1.json'),str(root/'reproducibility-results.json'),
        '本目录的text-package、note-bodies-final等是构建中间证据，不是交付版本；正式使用text-v1及本报告列出的归档。',
    ]
    (destination/'longman-local-package-validation-v1.txt').write_text('\n'.join(lines)+'\n')
    (root/'DELIVERY.txt').write_text('正式交付仅使用：\n'+str(text)+'\n'+files['text_xz']['path']+'\n'+files['text_zip']['path']+'\n'+str(audio)+'\n'+files['audio_zip']['path']+'\n报告：\n'+str(destination/'longman-local-package-validation-v1.txt')+'\n其他目录为构建、回归及可追溯中间证据。\n')
    (root/'checksums.sha256').write_text('\n'.join(v['sha256']+'  '+v['path'] for v in files.values())+'\n')
    print(json.dumps({'report':str(destination/'longman-local-package-validation-v1.txt'),'conclusion':report['conclusion'],'sizes':report['sizes']},ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
