import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve('.');
const require=createRequire(`${root}/package.json`);
const {_electron}=require('playwright');
const ExcelJS=require('exceljs');
const JSZip=require('jszip');
const artifacts=process.env.CALENDER_EXPORT_TEST_ARTIFACTS ?? await mkdtemp(join(tmpdir(),'calender-excel-output-'));
const data=await mkdtemp(join(tmpdir(),'calender-excel-ui-'));
const env={...process.env,CALENDAR_DESKTOP_TEST_DATA_DIR:data};
delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
let app,page;
const errors=[];
async function ready(){await page.locator('.export-preview[aria-busy="false"]').waitFor();await page.waitForFunction(()=>!document.querySelector('.capture-panel-actions .primary-button').disabled);}
async function saveFile(buttonName,fileName){
  const path=join(artifacts,fileName);
  const saved=app.evaluate(({session},path)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Download timed out')),30000);
    session.defaultSession.once('will-download',(_event,item)=>{
      const name=item.getFilename();item.setSavePath(path);
      item.once('done',(_event,state)=>{clearTimeout(timer);state==='completed'?resolve(name):reject(Error(state));});
    });
  }),path);
  const [name]=await Promise.all([saved,page.getByRole('button',{name:buttonName,exact:true}).click()]);
  return {name,path};
}
async function download(fileName){
  await ready();
  const {name,path}=await saveFile('Excelを保存',fileName);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(await readFile(path));
  for(const [index,sheet]of wb.worksheets.entries()){
    await page.getByRole('tab',{name:sheet.name,exact:true}).click();
    const cells=await page.locator('.export-sheet-table td').evaluateAll(cells=>cells.map(cell=>({address:cell.dataset.cell,text:cell.textContent,colSpan:cell.colSpan,rowSpan:cell.rowSpan})));
    for(const cell of cells){const original=sheet.getCell(cell.address);assert.equal(original.address,original.master.address);if(typeof original.value==='string')assert.equal(cell.text,original.value);}
    assert.equal(await page.getByRole('tab',{name:sheet.name,exact:true}).getAttribute('aria-selected'),'true');
  }
  await page.getByRole('tab').first().click();
  return {wb,name,path};
}
function sites(wb){return wb.worksheets.flatMap(sheet=>{const values=[];sheet.eachRow(row=>{if(row.getCell(2).value==='現場名'&&row.getCell(3).value)values.push(row.getCell(3).value);});return values;});}
try{
  app=await _electron.launch({executablePath:require('electron'),args:[root],env});
  page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.setViewportSize({width:1280,height:840});
  await page.getByRole('button',{name:'メンバー管理',exact:true}).click();
  for(const name of ['山田','田中']){
    await page.getByLabel('新しいメンバー名').fill(name);await page.locator('.local-member-add button').click();
    await page.getByLabel(name+'の名前',{exact:true}).waitFor();
  }
  const month=await page.evaluate(async()=>{
    const request=async(method,path,body)=>{const r=await window.calendarDesktop.request({method,path,body});if(!r.ok)throw Error(r.error);return r.data;};
    const {users}=await request('GET','/api/groups/local-workspace/members');
    const now=new Date();const year=now.getFullYear();const month=now.getMonth()+1;
    const prefix=`${year}-${String(month).padStart(2,'0')}`;
    const fixture=[
      [1,'合同作業',users,'09:00'],[1,'山田のみ',users.slice(0,1),'07:30'],
      [10,'10日の作業',users.slice(0,1),'08:00'],[11,'11日の作業',users.slice(1),'08:00'],
      [20,'20日の作業',users,'08:00'],[21,'21日の作業',users,'08:00'],
      [new Date(year,month,0).getDate(),'月末の作業',users,'08:00']
    ];
    for(const [day,name,members,startTime]of fixture){const date=`${prefix}-${String(day).padStart(2,'0')}`;await request('POST','/api/schedules',{siteName:name,content:'設備点検\n安全確認',date,endDate:date,startTime,endTime:'17:00',memberIds:members.map(m=>m.id),members:members.map(m=>m.name),contractor:'サンプル施工会社',address:'東京都千代田区',memo:'',tagColor:'#3b82f6'});}
    return {year,month,prefix,last:new Date(year,month,0).getDate()};
  });
  await page.reload();
  await page.getByRole('button',{name:'設定',exact:true}).first().click();
  await page.getByRole('button',{name:'画像出力を開く',exact:true}).click();
  await page.getByLabel('出力形式',{exact:true}).selectOption('xlsx');
  assert.equal(await page.getByLabel('Excelの対象月').inputValue(),`${month.year}年${month.month}月`);
  const full=await download('monthly-all.xlsx');
  assert.equal(full.name,`${month.prefix}.xlsx`);
  assert.deepEqual(full.wb.worksheets.map(s=>s.name),['1〜10日','11〜20日',`21〜${month.last}日`]);
  assert.equal(sites(full.wb).length,7);
  assert.equal(full.wb.worksheets[0].getCell('C3').value,'山田のみ');
  await page.getByLabel('出力対象',{exact:true}).selectOption('members');
  assert.ok(await page.locator('.capture-member-list').getByLabel('山田',{exact:true}).isChecked());
  assert.ok(await page.locator('.capture-member-list').getByLabel('田中',{exact:true}).isChecked());
  const both=await download('monthly-both-members.xlsx');
  assert.equal(both.name,`${month.prefix}.xlsx`);assert.equal(sites(both.wb).length,7);
  await page.locator('.capture-member-list').getByLabel('田中',{exact:true}).uncheck();
  const selected=await download('monthly-one-member.xlsx');
  assert.equal(sites(selected.wb).length,6);assert.ok(!sites(selected.wb).includes('11日の作業'));
  await page.locator('.capture-member-list').getByLabel('山田',{exact:true}).uncheck();
  assert.ok(await page.getByRole('button',{name:'Excelを保存',exact:true}).isDisabled());
  await page.locator('.capture-member-list').getByLabel('山田',{exact:true}).check();
  await ready();
  await page.getByLabel('プレビューの倍率').selectOption('1');
  assert.ok(await page.locator('.export-preview-viewport').evaluate(el=>el.scrollWidth>el.clientWidth));
  await page.getByLabel('プレビューの倍率').selectOption('fit');
  for(const size of [{width:1280,height:840},{width:980,height:680},{width:390,height:720}]){
    await page.setViewportSize(size);await ready();await page.screenshot({path:join(artifacts,`panel-${size.width}.png`)});
    const button=await page.getByRole('button',{name:'Excelを保存',exact:true}).boundingBox();
    assert.ok(button.x>=0&&button.y>=0&&button.x+button.width<=size.width&&button.y+button.height<=size.height);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:1280,height:840});
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'設定を閉じる',exact:true}).count().then(async count=>{if(count)await page.getByRole('button',{name:'設定を閉じる',exact:true}).click();});
  await page.locator('.setting-drawer.open .icon-button').count().then(async count=>{if(count)await page.locator('.setting-drawer.open .icon-button').first().click();});
  await page.locator('.segmented-control').getByRole('button',{name:'週',exact:true}).click();
  await page.getByRole('button',{name:'設定',exact:true}).first().click();
  await page.getByRole('button',{name:'画像出力を開く',exact:true}).click();
  await page.getByLabel('出力対象',{exact:true}).selectOption('current');
  const fromWeek=await download('monthly-from-week.xlsx');assert.equal(sites(fromWeek.wb).length,7);
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.locator('.setting-drawer.open .drawer-header .icon-button').click();
  await page.locator('.segmented-control').getByRole('button',{name:'月',exact:true}).click();
  await page.getByRole('button',{name:'設定',exact:true}).first().click();
  await page.getByRole('button',{name:'画像出力を開く',exact:true}).click();
  await page.getByLabel('出力形式',{exact:true}).selectOption('png');
  await ready();
  const png=page.getByAltText('カレンダー出力プレビュー');
  await png.waitFor();
  const pngInfo=await png.evaluate(async image=>{await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<240||pixels[i+1]<240||pixels[i+2]<240)colored++;return {width:image.naturalWidth,height:image.naturalHeight,colored,src:image.src};});
  assert.equal(pngInfo.width,1920);assert.equal(pngInfo.height,1080);assert.ok(pngInfo.colored>1000);
  const pngFile=await saveFile('PNGを保存','preview.png');
  assert.deepEqual(await readFile(pngFile.path),Buffer.from(pngInfo.src.split(',')[1],'base64'));
  await page.screenshot({path:join(artifacts,'preview-png.png')});
  await page.getByLabel('出力対象',{exact:true}).selectOption('members');
  await page.getByRole('button',{name:'全員',exact:true}).click();
  await ready();
  const memberSelect=page.getByLabel('画像プレビューのメンバー');
  const options=await memberSelect.locator('option').evaluateAll(options=>options.map(option=>({id:option.value,name:option.textContent})));
  const firstSource=await png.getAttribute('src');
  await memberSelect.selectOption(options[1].id);await ready();
  const secondSource=await png.getAttribute('src');assert.ok(secondSource!==firstSource,'Distinct monthly member tasks must produce different previews');
  const zipFile=await saveFile('ZIPを保存','preview-members.zip');
  const zip=await JSZip.loadAsync(await readFile(zipFile.path));
  assert.equal(Object.keys(zip.files).length,2);
  const matching=Object.keys(zip.files).find(name=>name.includes(options[1].name));
  assert.equal(await zip.file(matching).async('base64'),secondSource.split(',')[1]);
  // Rapid changes must not restore a stale PNG or an earlier member selection.
  await page.getByLabel('出力形式',{exact:true}).selectOption('xlsx');
  await page.getByLabel('出力形式',{exact:true}).selectOption('png');
  await page.getByLabel('出力形式',{exact:true}).selectOption('xlsx');
  await ready();assert.equal(await png.count(),0);assert.equal(await page.getByRole('tab').count(),3);
  await page.screenshot({path:join(artifacts,'preview-excel.png')});
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'画像出力を開く',exact:true}).click();await ready();
  await page.getByLabel('出力形式',{exact:true}).selectOption('png');
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'画像出力を開く',exact:true}).click();await ready();
  await png.waitFor();
  assert.deepEqual(errors,[]);
  console.log('Artifacts:',artifacts);
  console.log('PASS: live XLSX previews match downloaded cells on all 3 tabs, zoom/scroll, member refresh, empty selection guard, 3 viewport layouts, FHD nonblank PNG matches saved bytes, member preview/ZIP identity, rapid format changes, close/reopen, console health');
}catch(e){if(page&&!page.isClosed()){await page.screenshot({path:join(artifacts,'failure.png')});console.error((await page.locator('body').innerText()).slice(-3000));}throw e;}
finally{await app?.close();await rm(data,{recursive:true,force:true});}
