'use strict';
// High-resolution, one-page PDF. All rendering stays in the user's browser.
function renderReportCanvas(r,base=10){
 const canvas=document.createElement('canvas');const width=595.28,height=841.89,scale=3;
 canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
 const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.textBaseline='top';
 const margin=32,usable=width-margin*2;let y=32;
 const font=(size,bold=false)=>{ctx.font=`${bold?'600':'400'} ${size}px Arial, sans-serif`};
 const wrap=(value,maxWidth,size,bold=false)=>{font(size,bold);const lines=[];for(const paragraph of String(value??'').split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(ctx.measureText((line?line+' ':'')+word).width<=maxWidth){line+=(line?' ':'')+word;continue}if(line){lines.push(line);line=''}let chunk='';for(const char of word){if(chunk&&ctx.measureText(chunk+char).width>maxWidth){lines.push(chunk);chunk=''}chunk+=char}line=chunk}lines.push(line)}return lines};
 const drawLines=(lines,x,top,size,bold=false,color='#243042')=>{font(size,bold);ctx.fillStyle=color;lines.forEach((line,i)=>ctx.fillText(line,x,top+i*size*1.4));return lines.length*size*1.4};
 const text=(value,size=base,bold=false,color='#243042',x=margin,maxWidth=usable)=>{const lines=wrap(value,maxWidth,size,bold);y+=drawLines(lines,x,y,size,bold,color);return lines.length};
 const rule=()=>{ctx.fillStyle='#e0e5ed';ctx.fillRect(margin,y,usable,.7);y+=10};
 const section=(title,body)=>{y+=13;text(title,base,true,'#171717');y+=4;text(body)};
 const amount=t=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(t.amount)+' '+t.currency;
 const brandImage=document.querySelector('.brand-logo-image');if(brandImage?.complete&&brandImage.naturalWidth){ctx.drawImage(brandImage,margin+2,32,22,27)}else{ctx.strokeStyle='#243042';ctx.lineWidth=2;ctx.strokeRect(margin+5,34,16,22)}
 drawLines(['GrantEd'],margin+34,33,17,true,'#171717');drawLines(['Сопровождение поступления'],margin+34,53,8,false,'#636c79');y=66;
 drawLines([r.demo?'ДЕМОНСТРАЦИОННЫЙ ОТЧЁТ':'ОТЧЁТ ПО ЭТАПУ',fullDate((r.createdDate||r.createdAt.slice(0,10)))],width-230,35,8,false,'#636c79');
 y+=10;rule();text(r.client.name,20,true);y+=3;text(`${r.client.level} · ${r.client.semester&&r.client.semester!=='Не указан'?r.client.semester+' ':''}${r.client.year}`,9,false,'#636c79');y+=12;text(r.stage,12,true);text(`Период: ${fullDate(r.from)} — ${fullDate(r.to)}`,9,false,'#636c79');
 section('01 / Итоги этапа',r.done);
 y+=13;text('02 / Заявки в университеты',base,true,'#171717');y+=4;text(`На ${fullDate((r.createdDate||r.createdAt.slice(0,10)))}: заявок — ${r.appCount}, отправлено — ${r.sentCount}, офферов — ${r.offerCount}`,8,false,'#636c79');y+=8;
 const colWidths=[usable*.43,usable*.18,usable*.14,usable*.25];const xs=[margin];for(let i=0;i<3;i++)xs.push(xs[i]+colWidths[i]);
 const tableRow=(values,header=false)=>{const size=header?8:base-1;const lines=values.map((v,i)=>wrap(v,colWidths[i]-12,size,header));const rowHeight=Math.max(...lines.map(l=>l.length))*size*1.4+12;if(header){ctx.fillStyle='#fafafa';ctx.fillRect(margin,y,usable,rowHeight)}lines.forEach((l,i)=>drawLines(l,xs[i]+6,y+6,size,header));y+=rowHeight;ctx.fillStyle='#ebebeb';ctx.fillRect(margin,y,usable,.5)};
 if(r.applications.length){tableRow(['Университет / программа','Статус','Дедлайн','Application fee'],true);for(const a of r.applications){const fee=a.feeStatus==='waived'?'Waiver / без сбора':a.feeAmount===null?'Не указан':amount({amount:a.feeAmount,currency:a.feeCurrency});tableRow([a.university+'\n'+a.program,a.status,fmt(a.deadline),fee+(a.feeStatus==='unknown'||a.feeStatus==='waived'?'':'\n'+feeLabels[a.feeStatus])])}}else text('Подробные заявки не включены.',9,false,'#636c79');
 if(r.appCount>r.applications.length){y+=5;text(`Показано ${r.applications.length} из ${r.appCount} заявок. Сводка и расходы учитывают все заявки.`,8,false,'#636c79')}
 section('03 / Расходы клиента на application fee',`За период: ${r.periodFees.map(amount).join(' + ')||'нет оплат с датой в этом периоде'}\nВсего на дату отчёта: ${r.fees.map(amount).join(' + ')||'оплаченные сборы не внесены'}`);
 if(r.undatedPaid){y+=3;text(`${r.undatedPaid} оплат без даты учтены только в общем итоге.`,8,false,'#636c79')}
 section('04 / Следующий этап',r.next);
 y+=14;const actionLines=wrap(r.clientAction,usable-24,base);const actionHeight=actionLines.length*base*1.4+base*1.4+25;ctx.fillStyle='#fafafa';ctx.fillRect(margin,y,usable,actionHeight);ctx.fillStyle='#171717';ctx.fillRect(margin,y,2,actionHeight);drawLines(['Что нужно от вас'],margin+12,y+9,base,true);drawLines(actionLines,margin+12,y+base*1.4+14,base);y+=actionHeight+14;
 rule();text(`Консультант: ${r.client.consultant||'не указан'}`,8,false,'#636c79');y+=3;text('Пожалуйста, подтвердите ознакомление ответным сообщением.',8,false,'#636c79');
 return {canvas,fits:y<=height-margin,usedHeight:y};
}
function makeImagePdf(jpegBytes,imageWidth,imageHeight){
 const encoder=new TextEncoder(),parts=[],offsets=[0];let length=0;
 const add=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;parts.push(bytes);length+=bytes.length};
 const obj=(id,body)=>{offsets[id]=length;add(`${id} 0 obj\n${body}\nendobj\n`)};
 add('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Report 4 0 R >> >> /Contents 5 0 R >>');
 offsets[4]=length;add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);add(jpegBytes);add('\nendstream\nendobj\n');
 const content='q\n595.28 0 0 841.89 0 0 cm\n/Report Do\nQ\n';obj(5,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
 const xref=length;add('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);const result=new Uint8Array(length);let pos=0;for(const part of parts){result.set(part,pos);pos+=part.length}return result;
}
let lastReportPdfUrl=null;
async function downloadReportPdf(c,button){const r=selectedReport(c);if(!r)return;button.disabled=true;try{await document.fonts.ready;let output=renderReportCanvas(r,10);if(!output.fits)output=renderReportCanvas(r,9);if(!output.fits)throw new Error('Отчёт не помещается на одну страницу. Сократите текст или выберите меньше подробных заявок в новом отчёте.');const blob=await new Promise(resolve=>output.canvas.toBlob(resolve,'image/jpeg',.97));if(!blob)throw new Error('Браузер не смог сформировать PDF. Попробуйте печать.');const bytes=makeImagePdf(new Uint8Array(await blob.arrayBuffer()),output.canvas.width,output.canvas.height);if(lastReportPdfUrl)URL.revokeObjectURL(lastReportPdfUrl);const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=`GrantEd-report-${(r.createdDate||r.createdAt.slice(0,10))}-${r.id.slice(0,8)}.pdf`;lastReportPdfUrl=url;a.textContent='PDF готов — скачать файл';const downloadBox=$('#report-download');downloadBox.replaceChildren(a);a.click();toast('PDF сформирован. Отправку клиенту отметьте отдельно.')}catch(err){$('#report-fit-error').textContent=err.message}finally{button.disabled=false}}
