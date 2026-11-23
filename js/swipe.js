// AUR Desk — swipe rows, shared by Documents and Money.
//   Swipe right → Send.   Swipe left → shows Edit and Delete.   Tap → opens the item.
//   Up/down still scrolls the list. The screens that use this ask "Are you sure?" before acting.
import { icon } from './ui.js';

const SEND_AT = 96;   // px to the right that counts as "send"
const TRAY = 156;     // width of the Edit + Delete tray

// Wraps a row's markup. `front` is the row itself (a <button class="list-row …">…</button>).
export function swipeRow(kind, id, front, sendLabel = 'Send') {
  return `
  <div class="swipe" data-swipe-kind="${kind}" data-swipe="${id}">
    <div class="swipe-under swipe-send" aria-hidden="true">${icon('send')}<span>${sendLabel}</span></div>
    <div class="swipe-under swipe-tray">
      <button class="tray-btn tray-edit" data-act="edit" tabindex="-1">${icon('edit')}<span>Edit</span></button>
      <button class="tray-btn tray-delete" data-act="delete" tabindex="-1">${icon('trash')}<span>Delete</span></button>
    </div>
    ${front.replace('class="list-row', 'class="list-row swipe-front')}
  </div>`;
}

// handlers: { send(id), edit(id), delete(id) } — each may ask for confirmation itself
export function bindSwipeRows(root, kind, handlers) {
  let openRow = null;
  const close = (row) => {
    if (!row) return;
    row.querySelector('.swipe-front').style.transform = '';
    row.classList.remove('open');
    if (openRow === row) openRow = null;
  };

  root.querySelectorAll(`.swipe[data-swipe-kind="${kind}"]`).forEach((row) => {
    const front = row.querySelector('.swipe-front');
    const id = row.dataset.swipe;
    let x0 = 0, y0 = 0, dx = 0, base = 0, dragging = false, decided = false, moved = false;

    front.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (openRow && openRow !== row) close(openRow);
      x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; decided = false; dragging = true;
      base = row.classList.contains('open') ? -TRAY : 0;
      front.style.transition = 'none';
    });
    front.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        if (Math.abs(my) > Math.abs(mx)) { dragging = false; front.style.transition = ''; return; } // vertical: let the page scroll
        front.setPointerCapture(e.pointerId);
      }
      moved = true;
      dx = Math.max(-TRAY - 30, Math.min(SEND_AT + 40, base + mx));
      front.style.transform = `translateX(${dx}px)`;
      row.classList.toggle('going-right', dx > 0);
      row.classList.toggle('armed', dx >= SEND_AT);
    });
    const end = async () => {
      if (!dragging) return;
      dragging = false;
      front.style.transition = '';
      row.classList.remove('armed');
      if (!moved) return;
      if (dx >= SEND_AT) { front.style.transform = ''; await handlers.send(id); return; }
      if (dx <= -TRAY / 2) { front.style.transform = `translateX(${-TRAY}px)`; row.classList.add('open'); openRow = row; }
      else close(row);
    };
    front.addEventListener('pointerup', end);
    front.addEventListener('pointercancel', end);
    // a drag is not a tap: don't open the item after swiping
    front.addEventListener('click', (e) => {
      if (moved || row.classList.contains('open')) {
        e.stopImmediatePropagation(); e.preventDefault();
        if (!moved) close(row);
        moved = false;
      }
    }, true);

    row.querySelector('[data-act=edit]').onclick = () => { close(row); handlers.edit(id); };
    row.querySelector('[data-act=delete]').onclick = () => { close(row); handlers.delete(id); };
  });
}
