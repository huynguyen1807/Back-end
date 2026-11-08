export type FoodState = 'RAW' | 'COOKED' | 'UNKNOWN';
export type StorageGuide = {
  minDays: number; maxDays: number; label: string; temperature: string;
  kind: 'QUALITY' | 'REFRIGERATED_WINDOW'; sourceUrl: string; conditions: string;
  sourceLabel?: string;
  dateAnchor?: 'PURCHASE' | 'HANDLING';
};
export type StorageOptions = { storageProfile?: string; packaging?: string };
export type StorageAdvice = { guide: StorageGuide | null; message: string; profiles: { value: string; label: string }[]; recommendedStorage?: string };
export const STORAGE_SOURCE = 'https://www.foodsafety.gov/food-safety-charts/cold-food-storage-charts';
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();

/** Conservative reminders from the cited chart, never an image-derived safety guarantee. */
function getMeatGuidance(foodName: string, state: FoodState, storageType: string): StorageGuide | null {
  const name = normalize(foodName);
  if (state === 'UNKNOWN' || !['REFRIGERATOR', 'FREEZER'].includes(storageType)) return null;
  let fridge: [number, number] | undefined;
  let frozen: [number, number] | undefined;
  let label = '';
  if (state === 'RAW') {
    if (/\b(ca hoi|ca thu|ca ngu|salmon|tuna|mackerel)\b/.test(name)) { fridge = [1, 3]; frozen = [60, 90]; label = 'Cá béo sống'; }
    else if (/\b(thit xay|thit bam|ground|minced)\b/.test(name)) { fridge = [1, 2]; frozen = [90, 120]; label = 'Thịt xay sống'; }
    else if (/\b(ga|vit|chicken|turkey)\b/.test(name)) { fridge = [1, 2]; frozen = /nguyen con|whole/.test(name) ? [365, 365] : [270, 270]; label = 'Thịt gia cầm sống'; }
    else if (/\b(thit bo|thit heo|thit lon|thit cuu|beef|pork|lamb)\b/.test(name)) { fridge = [3, 5]; frozen = [120, 365]; label = 'Thịt đỏ sống, nguyên miếng'; }
  } else {
    if (/\b(canh|sup|soup|stew)\b/.test(name)) { fridge = [3, 4]; frozen = [60, 90]; label = 'Canh / súp đã nấu'; }
    else if (/\b(thit|ga|vit|beef|pork|chicken|turkey)\b/.test(name)) { fridge = [3, 4]; frozen = [60, 180]; label = 'Thịt / gia cầm đã nấu'; }
  }
  const range = storageType === 'FREEZER' ? frozen : fridge;
  if (!range) return null;
  return {
    minDays: range[0], maxDays: range[1], label,
    temperature: storageType === 'FREEZER' ? '≤ −18°C liên tục' : '≤ 4°C liên tục',
    kind: storageType === 'FREEZER' ? 'QUALITY' : 'REFRIGERATED_WINDOW', sourceUrl: STORAGE_SOURCE,
    conditions: 'Áp dụng khi thực phẩm còn phù hợp lúc bắt đầu bảo quản, được bọc kín và giữ đúng nhiệt độ. Ưu tiên hướng dẫn trên bao bì. Đổi ngăn hoặc đổi ngày không làm thực phẩm tươi lại.',
  };
}

const HOME_SOURCE = 'https://food.unl.edu/free-resource/food-storage/';
const FRUIT_SOURCE = 'https://www.gov.nl.ca/healthyeating/veggiesandfruit/storage/vegetables-and-fruits-storage/';
const choice = (value: string, label: string) => ({ value, label });
/** Product form is user-confirmed: an image cannot establish ripeness, opening date or cheese type. */
export function getStorageAdvice(foodName: string, state: FoodState, storageType: string, options: StorageOptions = {}): StorageAdvice {
  const name = normalize(foodName.trim()), profile = options.storageProfile, pack = options.packaging;
  const profiles: StorageAdvice['profiles'] = [];
  let fridge: [number, number] | undefined, frozen: [number, number] | undefined;
  let label = '', message = '', sourceUrl = HOME_SOURCE, sourceLabel = 'Nebraska Extension';
  let recognized = false;
  let dateAnchor: StorageGuide['dateAnchor'] = 'PURCHASE';
  // Exact family matches avoid treating apple juice, avocado oil or nut butter as fresh produce/dairy.
  const processed = /\b(nuoc ep|sinh to|mut|sot|sauce|juice|smoothie|jam|dried|kho|say|dong hop|canned|dau|oil)\b/.test(name);
  const pineappleName = /\bpineapple\b/.test(name) || /^(qua |trai )?(thom|khom)\b/.test(name) || /dứa/i.test(foodName);
  const appleName = /\b(apple|apples)\b/.test(name) || /\btao\b/.test(name) && !/\btao (tau|meo)\b/.test(name);
  if ((!processed && (appleName || /\b(avocado|qua bo|trai bo)\b/.test(name) || pineappleName)) || name === 'bo') {
    recognized = true;
    const avocado = /avocado|qua bo|trai bo/.test(name) || name === 'bo';
    const pineapple = pineappleName;
    profiles.push(...(avocado ? [choice('UNRIPE_WHOLE', 'Nguyên quả, chưa chín'), choice('RIPE_WHOLE', 'Nguyên quả, đã chín'), choice('CUT', 'Đã cắt / bổ')] : [choice('WHOLE', 'Nguyên quả'), choice('CUT', 'Đã cắt / gọt')]));
    if (name === 'bo') profiles.push(choice('BUTTER', 'Đây là bơ sữa (butter)'));
    message = avocado ? 'Bơ quả: để chín ở nơi thoáng, tránh nắng; khi chín chuyển tủ mát. Chọn độ chín thực tế bên dưới.' : 'Quả nguyên và quả đã cắt có thời gian khác nhau. Quả đã cắt cần đậy kín và giữ tủ mát.';
    if (avocado && profile === 'RIPE_WHOLE') { fridge = [3, 4]; dateAnchor = 'HANDLING'; label = 'Bơ quả đã chín, còn nguyên'; }
    else if (!avocado && profile === 'WHOLE') { fridge = pineapple ? [5, 7] : [28, 42]; label = pineapple ? 'Dứa / thơm nguyên quả' : 'Táo nguyên quả'; }
    else if (profile === 'CUT') {
      dateAnchor = 'HANDLING';
      fridge = pineapple ? [3, 7] : [1, 2]; label = pineapple ? 'Dứa đã cắt' : avocado ? 'Bơ quả đã cắt' : 'Táo đã cắt';
      sourceUrl = FRUIT_SOURCE; sourceLabel = 'Chính quyền Newfoundland & Labrador';
    }
    if (name === 'bo') {
      message = '“Bơ” có thể là quả bơ hoặc bơ sữa. Chọn đúng loại bên dưới trước khi áp dụng mốc.';
      if (profile === 'BUTTER') { fridge = [30, 60]; frozen = [180, 270]; label = 'Bơ sữa'; }
    }
    if (profile === 'UNRIPE_WHOLE' && avocado) message = 'Bơ chưa chín: để nơi thoáng, tránh nắng đến khi chín; kiểm tra mỗi ngày. Chưa ấn định ngày dùng theo ảnh. Khi chín, chọn lại “Nguyên quả, đã chín” và ngày bắt đầu giữ lạnh.';
    else if (storageType !== 'REFRIGERATOR' && profile !== 'BUTTER') message += storageType === 'FREEZER' ? ' Muốn cấp đông cần sơ chế phù hợp từng loại; chưa áp dụng mốc ngày cho quả nguyên bỏ trực tiếp vào ngăn đông. Chọn tủ mát hoặc dùng hướng dẫn sơ chế/bao bì.' : ' Các mốc bên dưới áp dụng ở tủ mát ≤ 4°C; chọn tủ mát để xem mốc tương ứng. Không áp dụng thời gian phòng mát cho khí hậu nóng.';
  } else if (/\b(pho mai|phomai|cheese)\b/.test(name) && !/\b(banh|pizza|sauce|sot)\b/.test(name)) {
    recognized = true;
    profiles.push(choice('HARD_CHEESE', 'Phô mai cứng nguyên khối'), choice('SOFT_CHEESE', 'Phô mai mềm (Brie…)'), choice('CREAM_CHEESE', 'Cream cheese'), choice('COTTAGE_RICOTTA', 'Cottage / ricotta'));
    message = 'Chọn đúng loại và gói còn kín/đã mở. Phô mai bào, phô mai chế biến hoặc loại khác: ưu tiên hướng dẫn trên nhãn, không dùng mốc của phô mai cứng.';
    const opened = pack === 'OPENED' || pack === 'PORTIONED';
    if (opened) dateAnchor = 'HANDLING';
    if (pack === 'SEALED' || opened) {
      if (profile === 'HARD_CHEESE') { fridge = opened ? [21, 28] : [180, 180]; frozen = [180, 180]; label = `Phô mai cứng nguyên khối · ${opened ? 'đã mở' : 'còn kín'}`; }
      if (profile === 'SOFT_CHEESE') { fridge = [7, 14]; frozen = [180, 180]; label = 'Phô mai mềm'; }
      if (profile === 'CREAM_CHEESE') { fridge = [14, 14]; label = 'Cream cheese'; }
      if (profile === 'COTTAGE_RICOTTA') { fridge = opened ? [7, 7] : [14, 14]; label = `Cottage / ricotta · ${opened ? 'đã mở' : 'còn kín'}`; }
    }
  } else if (/\b(bo sua|bo dong vat|bo lat|bo man|butter)\b/.test(name) && !/\b(peanut|nut|dau phong|hat|banh|cookie)\b/.test(name)) {
    recognized = true; profiles.push(choice('BUTTER', 'Bơ sữa (butter)'));
    message = 'Bơ sữa khác với quả bơ và margarine. Bọc kín, tránh ám mùi; ưu tiên thời gian và nhiệt độ trên nhãn.';
    if (profile === 'BUTTER') { fridge = [30, 60]; frozen = [180, 270]; label = 'Bơ sữa'; }
  } else if (/\b(sua tuoi|milk)\b/.test(name) && !/\b(hat|hanh nhan|dau nanh|almond|soy|oat|coconut|bot|powder|dac|condensed|breast|me|raw|chua tiet trung)\b/.test(name)) {
    recognized = true; profiles.push(choice('PASTEURIZED_MILK', 'Sữa thanh trùng, luôn giữ lạnh'), choice('UHT_MILK', 'Sữa tiệt trùng UHT'));
    message = 'Kiểm tra nhãn thanh trùng/UHT và gói còn kín/đã mở. UHT còn kín dùng hạn và cách bảo quản của nhà sản xuất. Sau mở phải giữ lạnh; nếu nhãn yêu cầu dùng sớm hơn thì theo nhãn.';
    const opened = pack === 'OPENED' || pack === 'PORTIONED';
    if (profile === 'PASTEURIZED_MILK' && (pack === 'SEALED' || opened)) { fridge = [7, 7]; label = 'Sữa thanh trùng giữ lạnh'; }
    // UHT opened durations vary by manufacturer; do not borrow pasteurized milk's 7-day window.
  }
  if (!recognized) {
    const guide = getMeatGuidance(foodName, state, storageType);
    return { guide, profiles, message: guide ? 'Đối chiếu trạng thái thực tế và nhiệt độ trước khi áp dụng.' : 'Chưa có mốc ngày đã đối chiếu cho món/điều kiện này. Kiểm tra tên, trạng thái và nơi bảo quản; dùng hướng dẫn trên bao bì. Có thể bỏ tick để lưu các món khác trước.', recommendedStorage: getMeatGuidance(foodName, state, 'REFRIGERATOR') ? 'REFRIGERATOR' : undefined };
  }
  const range = storageType === 'REFRIGERATOR' ? fridge : storageType === 'FREEZER' ? frozen : undefined;
  if (state === 'COOKED') return { guide: null, profiles, message: 'Mốc của sản phẩm tươi/nguyên dạng không áp dụng cho món đã nấu hoặc đã trộn. Dùng hướng dẫn phù hợp món đã chế biến.', recommendedStorage: 'REFRIGERATOR' };
  return { profiles, message, recommendedStorage: 'REFRIGERATOR', guide: range ? {
    minDays: range[0], maxDays: range[1], label, sourceUrl, sourceLabel,
    temperature: storageType === 'FREEZER' ? '≤ −18°C liên tục' : '≤ 4°C liên tục', kind: storageType === 'FREEZER' ? 'QUALITY' : 'REFRIGERATED_WINDOW',
    dateAnchor, conditions: `${message} Tính từ ${dateAnchor === 'PURCHASE' ? 'ngày mua của lô, không tính lại từ ngày mở/chuyển ngăn' : profile === 'RIPE_WHOLE' ? 'ngày bắt đầu giữ lạnh sau khi chín' : 'ngày mở gói/cắt thực tế, khi thực phẩm còn phù hợp'}. Mốc tham khảo không thay thế nhãn hoặc xác nhận an toàn.`,
  } : null };
}
export function getStorageGuidance(foodName: string, state: FoodState, storageType: string, options: StorageOptions = {}) {
  return getStorageAdvice(foodName, state, storageType, options).guide;
}

export function referenceFoodStatus(expiryDate: Date, basis?: string, now = new Date()) {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.round((day(expiryDate) - day(now)) / 86400000);
  if (days < 0) return basis === 'REFERENCE' ? 'NEED_CHECK' : 'EXPIRED';
  return days <= 3 ? 'NEAR_EXPIRY' : 'SAFE';
}
