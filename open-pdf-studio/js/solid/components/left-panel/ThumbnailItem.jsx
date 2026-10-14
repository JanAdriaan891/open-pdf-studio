import { Show } from 'solid-js';
import {
  activePage, thumbnailData, draggedPage, setDraggedPage, dropTarget, setDropTarget, placeholderSize,
  selectedPages, selectPage, togglePageSelection, selectPageRange, isPageSelected
} from '../../stores/panels/thumbnailStore.js';
import { showThumbnailMenu } from '../../stores/contextMenuStore.js';
import { dropPositie } from '../../../ui/panels/miniatuur-maat.js';

// Staan de miniaturen in meerdere kolommen (breed paneel, #579)? Dan zijn de
// buren links en rechts en valt een gesleepte pagina ervoor of erachter.
function meerdereKolommen(item) {
  const lijst = item?.parentElement;
  if (!lijst) return false;
  const kolommen = getComputedStyle(lijst).gridTemplateColumns || '';
  return kolommen.trim().split(/\s+/).filter(Boolean).length > 1;
}

export default function ThumbnailItem(props) {
  const isActive = () => activePage() === props.pageNum;
  const imageData = () => thumbnailData[String(props.pageNum)];
  const isDragging = () => draggedPage() === props.pageNum;
  const drop = () => dropTarget();
  const isDropBefore = () => drop()?.page === props.pageNum && drop()?.position === 'before';
  const isDropAfter = () => drop()?.page === props.pageNum && drop()?.position === 'after';
  const isDropNaast = () => drop()?.page === props.pageNum && !!drop()?.naast;
  const isSelected = () => { selectedPages(); return isPageSelected(props.pageNum); };

  const size = () => placeholderSize();

  const handleClick = (e) => {
    if (e.ctrlKey && e.shiftKey) {
      selectPageRange(props.pageNum, true);
    } else if (e.shiftKey) {
      selectPageRange(props.pageNum, false);
    } else if (e.ctrlKey) {
      togglePageSelection(props.pageNum);
    } else {
      selectPage(props.pageNum);
      props.onNavigate(props.pageNum);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicked page is not in selection, select it alone
    if (!isPageSelected(props.pageNum)) {
      selectPage(props.pageNum);
    }
    showThumbnailMenu(e.clientX, e.clientY, props.pageNum);
  };

  return (
    <div
      class="thumbnail-item"
      classList={{
        active: isActive(),
        selected: isSelected(),
        dragging: isDragging(),
        'drop-before': isDropBefore(),
        'drop-after': isDropAfter(),
        'drop-side': isDropNaast()
      }}
      data-page={props.pageNum}
      draggable={true}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragStart={(e) => {
        setDraggedPage(props.pageNum);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(props.pageNum));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedPage() === props.pageNum) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const naast = meerdereKolommen(e.currentTarget);
        setDropTarget({ page: props.pageNum, position: dropPositie(rect, e.clientX, e.clientY, naast), naast });
      }}
      onDragLeave={() => {
        if (dropTarget()?.page === props.pageNum) setDropTarget(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropTarget(null);
        if (draggedPage() !== null && draggedPage() !== props.pageNum) {
          const rect = e.currentTarget.getBoundingClientRect();
          const naast = meerdereKolommen(e.currentTarget);
          const dropBefore = dropPositie(rect, e.clientX, e.clientY, naast) === 'before';
          props.onReorder(draggedPage(), props.pageNum, dropBefore);
        }
        setDraggedPage(null);
      }}
      onDragEnd={() => {
        setDraggedPage(null);
        setDropTarget(null);
      }}
    >
      <Show when={imageData()} fallback={
        <div class="thumbnail-canvas thumbnail-loading" style={{ 'aspect-ratio': `${size().width} / ${size().height}` }}>
          <div class="thumbnail-spinner" />
        </div>
      }>
        {/* Vult de kolombreedte (layout.css); gerenderd op die breedte maal
            devicePixelRatio, dus scherp ook als het paneel breed is (#579). */}
        <img class="thumbnail-canvas" src={imageData().dataURL} />
      </Show>
      <div class="thumbnail-label">{props.pageNum}</div>
    </div>
  );
}
