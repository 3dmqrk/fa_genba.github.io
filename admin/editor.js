(() => {
  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const fields = ['title', 'date', 'excerpt'];
  const draftKey = 'fa-genba-editor-draft-v1';
  const images = new Map();
  let pendingImage = null;
  let pendingRange = null;
  let cropState = { x: .1, y: .1, w: .8, h: .8 };

  const slugify = (value) => (value || 'article').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'article';
  const selectedCategories = () => [...document.querySelectorAll('.categories input:checked')].map((input) => input.value);
  const escapeYaml = (value) => String(value || '').replace(/"/g, '\\"');
  const escapeHtml = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const download = (name, content, type) => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); };

  const nodeToMarkdown = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00a0/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const content = [...node.childNodes].map(nodeToMarkdown).join('');
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === 'p' || tag === 'div') return `\n\n${content.trim()}\n\n`;
    if (tag === 'strong' || tag === 'b') return `**${content}**`;
    if (tag === 'em' || tag === 'i') return `*${content}*`;
    if (tag === 'a') return `[${content}](${node.getAttribute('href') || ''})`;
    if (tag === 'br') return '\n';
    if (tag === 'ul') return `\n${[...node.children].map((li) => `- ${nodeToMarkdown(li).trim()}`).join('\n')}\n`;
    if (tag === 'ol') return `\n${[...node.children].map((li, i) => `${i + 1}. ${nodeToMarkdown(li).trim()}`).join('\n')}\n`;
    if (tag === 'li') return content;
    if (tag === 'pre') { const code = node.querySelector('code'); const language = code?.dataset.language || (code?.className.match(/language-([\w-]+)/)?.[1]) || 'text'; return `\n\n\`\`\`${language}\n${code?.textContent || node.textContent}\n\`\`\`\n\n`; }
    if (tag === 'figure') { const image = node.querySelector('img'); const caption = node.querySelector('figcaption')?.textContent.trim(); if (!image) return ''; const src = `/assets/images/${image.dataset.filename || 'image.webp'}`; const width = image.style.width; if (!width) return `\n\n![${image.alt || ''}](${src})${caption ? `\n*${caption}*` : ''}\n\n`; return `\n\n<figure class="article-image" style="width: ${width};">\n  <img src="${src}" alt="${escapeHtml(image.alt)}">${caption ? `\n  <figcaption>${escapeHtml(caption)}</figcaption>` : ''}\n</figure>\n\n`; }
    return content;
  };
  const markdown = () => {
    const date = $('date').value || new Date().toISOString().slice(0, 10);
    const body = [...editor.childNodes].map(nodeToMarkdown).join('').replace(/\n{3,}/g, '\n\n').trim();
    return `---\nlayout: post\ntitle: "${escapeYaml($('title').value || '記事タイトル')}"\ndate: ${date} 12:00:00 +0900\ncategories: [${selectedCategories().join(', ')}]\nexcerpt: "${escapeYaml($('excerpt').value)}"\n---\n\n${body}\n`;
  };
  const preview = () => { $('preview').innerHTML = editor.innerHTML || '<p>本文を書くと、ここにプレビューが表示されます。</p>'; };
  const saveDraft = () => { try { localStorage.setItem(draftKey, JSON.stringify({ title: $('title').value, date: $('date').value, excerpt: $('excerpt').value, categories: selectedCategories(), html: editor.innerHTML })); $('save-state').textContent = '下書きをこの端末に保存しました'; } catch { $('save-state').textContent = '画像が大きいため、本文のみ保存されました'; } };
  const restoreDraft = () => { try { const draft = JSON.parse(localStorage.getItem(draftKey)); if (!draft) return; fields.forEach((field) => { $(field).value = draft[field] || ''; }); document.querySelectorAll('.categories input').forEach((input) => { input.checked = draft.categories?.includes(input.value); }); editor.innerHTML = draft.html || ''; editor.querySelectorAll('figure').forEach(enableImageResize); preview(); } catch {} };
  const selectionInsert = (element) => { editor.focus(); const selection = window.getSelection(); if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) editor.append(element); else { const range = selection.getRangeAt(0); range.deleteContents(); range.insertNode(element); range.setStartAfter(element); selection.removeAllRanges(); selection.addRange(range); } editor.dispatchEvent(new Event('input')); };
  const insertCode = (language, source) => { const pre = document.createElement('pre'); const code = document.createElement('code'); code.dataset.language = language; code.className = `language-${language}`; code.textContent = source; pre.append(code); selectionInsert(pre); };
  const clearImageSelection = () => editor.querySelectorAll('figure.image-selected').forEach((figure) => figure.classList.remove('image-selected'));
  const enableImageResize = (figure) => {
    if (figure.dataset.resizeReady) return;
    figure.dataset.resizeReady = 'true';
    const controls = document.createElement('span');
    controls.className = 'image-resize-controls'; controls.contentEditable = 'false';
    ['nw', 'ne', 'sw', 'se'].forEach((corner) => { const handle = document.createElement('button'); handle.type = 'button'; handle.className = `resize-handle ${corner}`; handle.dataset.corner = corner; handle.setAttribute('aria-label', '画像サイズを変更'); controls.append(handle); });
    figure.append(controls);
    figure.addEventListener('click', (event) => { if (!event.target.closest('.resize-handle')) { clearImageSelection(); figure.classList.add('image-selected'); } });
    controls.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('.resize-handle'); if (!handle) return;
      event.preventDefault(); const image = figure.querySelector('img'); const startX = event.clientX; const startWidth = image.getBoundingClientRect().width; const maxWidth = figure.parentElement.getBoundingClientRect().width; const direction = handle.dataset.corner.includes('w') ? -1 : 1;
      const move = (moveEvent) => { const width = Math.max(160, Math.min(maxWidth, startWidth + (moveEvent.clientX - startX) * direction)); image.style.width = `${Math.round(width / maxWidth * 100)}%`; figure.classList.add('image-selected'); preview(); saveDraft(); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  };
  const slashMenu = $('slash-menu');
  let slashBlock = null;
  const setCursor = (element) => { const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.focus?.(); };
  const slashActions = [
    { key: 'text', icon: 'T', title: 'テキスト', help: '通常の本文を追加', run: () => document.createElement('p') },
    { key: 'heading', icon: 'H', title: '見出し', help: '章・節の見出しを追加', run: () => document.createElement('h2') },
    { key: 'list', icon: '•', title: '箇条書き', help: '項目をリスト化', run: () => { const list = document.createElement('ul'); list.innerHTML = '<li></li>'; return list; } },
    { key: 'code', icon: '</>', title: 'コード・設定値', help: '設定例やコードを追加', run: () => { const pre = document.createElement('pre'); const code = document.createElement('code'); code.dataset.language = 'text'; code.className = 'language-text'; code.textContent = '設定値やコードをここに書きます'; pre.append(code); return pre; } },
    { key: 'mermaid', icon: '◫', title: 'Mermaid図', help: 'フローチャートや構成図を追加', run: () => { const pre = document.createElement('pre'); const code = document.createElement('code'); code.dataset.language = 'mermaid'; code.className = 'language-mermaid'; code.textContent = 'flowchart LR\n  A[開始] --> B{確認}\n  B --> C[完了]'; pre.append(code); return pre; } },
    { key: 'image', icon: '▧', title: '画像', help: '画像を追加・トリミング', run: () => { $('image-input').click(); return null; } }
  ];
  const closeSlash = () => { slashMenu.hidden = true; slashBlock = null; };
  const applySlash = (action) => { if (!slashBlock) return; const block = action.run(); if (block) { slashBlock.replaceWith(block); setCursor(block.querySelector('li, code') || block); editor.dispatchEvent(new Event('input')); } closeSlash(); };
  const openSlash = (block) => { slashBlock = block; slashMenu.innerHTML = slashActions.map((action) => `<button type="button" data-slash="${action.key}"><span>${action.icon}</span><span><b>${action.title}</b><small>${action.help}</small></span></button>`).join(''); const rect = block.getBoundingClientRect(); slashMenu.style.left = `${Math.max(16, rect.left)}px`; slashMenu.style.top = `${rect.bottom + window.scrollY + 4}px`; slashMenu.hidden = false; };
  slashMenu.addEventListener('click', (event) => { const key = event.target.closest('[data-slash]')?.dataset.slash; const action = slashActions.find((item) => item.key === key); if (action) applySlash(action); });

  document.querySelector('.toolbar').addEventListener('click', (event) => { const command = event.target.closest('button')?.dataset.command; if (!command) return; event.preventDefault(); editor.focus(); if (command === 'h2') document.execCommand('formatBlock', false, 'h2'); if (command === 'bold') document.execCommand('bold'); if (command === 'italic') document.execCommand('italic'); if (command === 'ul') document.execCommand('insertUnorderedList'); if (command === 'ol') document.execCommand('insertOrderedList'); if (command === 'link') { const url = window.prompt('リンク先URL'); if (url) document.execCommand('createLink', false, url); } if (command === 'code') insertCode('text', '設定値やコードをここに書きます'); if (command === 'mermaid') insertCode('mermaid', 'flowchart LR\n  A[開始] --> B{確認}\n  B --> C[完了]'); });
  editor.addEventListener('input', () => { const selection = window.getSelection(); const node = selection?.anchorNode; const block = node?.nodeType === Node.ELEMENT_NODE ? node.closest?.('p,div') : node?.parentElement?.closest('p,div'); if (block?.textContent.trim() === '/') openSlash(block); else if (slashBlock) closeSlash(); preview(); saveDraft(); });
  editor.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSlash(); });
  [...document.querySelectorAll('input, textarea')].forEach((element) => element.addEventListener('input', saveDraft));
  document.querySelectorAll('.categories input').forEach((input) => input.addEventListener('change', saveDraft));

  const renderCropFrame = () => { const frame = $('crop-frame'); frame.style.left = `${cropState.x * 100}%`; frame.style.top = `${cropState.y * 100}%`; frame.style.width = `${cropState.w * 100}%`; frame.style.height = `${cropState.h * 100}%`; };
  const setCropRatio = () => { const ratio = Number($('crop-ratio').value); if (!ratio || !pendingImage?.ratio) return renderCropFrame(); let w = .82; let h = w * pendingImage.ratio / ratio; if (h > .82) { h = .82; w = h * ratio / pendingImage.ratio; } cropState = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }; renderCropFrame(); };
  const prepareImage = (file) => { if (!file?.type.startsWith('image/')) return window.alert('PNG、JPEG、WebP形式の画像を選んでください。'); const reader = new FileReader(); reader.onload = () => { const preview = $('crop-image'); preview.onload = () => { pendingImage = { data: reader.result, originalName: file.name, ratio: preview.naturalWidth / preview.naturalHeight }; preview.parentElement.style.aspectRatio = String(pendingImage.ratio); cropState = { x: .1, y: .1, w: .8, h: .8 }; $('image-alt').value = ''; $('image-caption').value = ''; setCropRatio(); $('crop-dialog').showModal(); }; preview.src = reader.result; }; reader.readAsDataURL(file); };
  $('image-input').addEventListener('change', (event) => { prepareImage(event.target.files[0]); event.target.value = ''; });
  ['dragenter', 'dragover'].forEach((type) => editor.addEventListener(type, (event) => { event.preventDefault(); editor.classList.add('is-drag-over'); }));
  ['dragleave', 'drop'].forEach((type) => editor.addEventListener(type, (event) => { event.preventDefault(); editor.classList.remove('is-drag-over'); }));
  editor.addEventListener('drop', (event) => { const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('image/')); if (!file) return; const rangeFromPoint = document.caretRangeFromPoint?.(event.clientX, event.clientY); if (rangeFromPoint && editor.contains(rangeFromPoint.startContainer)) pendingRange = rangeFromPoint; prepareImage(file); });
  $('crop-ratio').addEventListener('input', setCropRatio);
  const cropFrame = $('crop-frame');
  cropFrame.addEventListener('pointerdown', (event) => { const handle = event.target.dataset.cropHandle; const stage = $('crop-image').getBoundingClientRect(); const start = { ...cropState, pointerX: event.clientX, pointerY: event.clientY }; const clamp = (value, min, max) => Math.max(min, Math.min(max, value)); const move = (moveEvent) => { const dx = (moveEvent.clientX - start.pointerX) / stage.width; const dy = (moveEvent.clientY - start.pointerY) / stage.height; let next = { x: start.x, y: start.y, w: start.w, h: start.h }; if (!handle) { next.x = clamp(start.x + dx, 0, 1 - start.w); next.y = clamp(start.y + dy, 0, 1 - start.h); } else { const right = start.x + start.w; const bottom = start.y + start.h; if (handle.includes('w')) { next.x = clamp(start.x + dx, 0, right - .08); next.w = right - next.x; } if (handle.includes('e')) next.w = clamp(start.w + dx, .08, 1 - start.x); if (handle.includes('n')) { next.y = clamp(start.y + dy, 0, bottom - .08); next.h = bottom - next.y; } if (handle.includes('s')) next.h = clamp(start.h + dy, .08, 1 - start.y); cropState = next; renderCropFrame(); }; const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
  $('insert-image').addEventListener('click', (event) => { event.preventDefault(); if (!pendingImage) return; const source = new Image(); source.onload = () => { const actualWidth = source.width * cropState.w; const actualHeight = source.height * cropState.h; const outputWidth = Math.min(1600, Math.round(actualWidth)); const canvas = document.createElement('canvas'); canvas.width = outputWidth; canvas.height = Math.round(outputWidth * actualHeight / actualWidth); canvas.getContext('2d').drawImage(source, source.width * cropState.x, source.height * cropState.y, actualWidth, actualHeight, 0, 0, canvas.width, canvas.height); const data = canvas.toDataURL('image/webp', .88); const filename = `${slugify(pendingImage.originalName.replace(/\.[^.]+$/, ''))}-${Date.now()}.webp`; images.set(filename, data); const figure = document.createElement('figure'); const image = new Image(); image.src = data; image.alt = $('image-alt').value; image.dataset.filename = filename; const caption = document.createElement('figcaption'); caption.textContent = $('image-caption').value; figure.append(image, caption); enableImageResize(figure); if (pendingRange) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(pendingRange); } selectionInsert(figure); pendingRange = null; $('crop-dialog').close(); pendingImage = null; }; source.src = pendingImage.data; });

  $('copy-md').addEventListener('click', async () => { await navigator.clipboard.writeText(markdown()); $('copy-md').textContent = 'コピーしました'; setTimeout(() => { $('copy-md').textContent = 'Markdownをコピー'; }, 1600); });
  $('download-md').addEventListener('click', () => download(`${slugify($('title').value)}.md`, markdown(), 'text/markdown;charset=utf-8'));
  $('download-images').addEventListener('click', () => { if (!images.size) return window.alert('追加した画像はありません。'); images.forEach((data, filename) => fetch(data).then((response) => response.blob()).then((blob) => download(filename, blob, 'image/webp'))); });
  $('new-post').addEventListener('click', () => { if (window.confirm('現在の下書きを消して新規記事を始めますか？')) { localStorage.removeItem(draftKey); location.reload(); } });
  $('date').value = new Date().toISOString().slice(0, 10); restoreDraft(); preview();
})();
