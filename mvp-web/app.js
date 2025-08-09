(function(){
  const timelineEl = document.getElementById('timeline');
  const citySelect = document.getElementById('citySelect');
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  const interestsWrap = document.getElementById('interests');
  const paceSelect = document.getElementById('pace');
  const generateBtn = document.getElementById('generateBtn');
  const resetBtn = document.getElementById('resetBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const exportIcsBtn = document.getElementById('exportIcsBtn');
  const bookLinks = document.getElementById('bookLinks');
  const bookFlights = document.getElementById('bookFlights');
  const bookStays = document.getElementById('bookStays');

  let DATA; // loaded POIs
  let currentPlan = null;

  async function loadData(){
    const res = await fetch('./data/pois.json');
    DATA = await res.json();
  }

  function daysBetween(a, b){
    const start = new Date(a);
    const end = new Date(b);
    if (end < start) return 1;
    const ms = end.setHours(0,0,0,0) - start.setHours(0,0,0,0);
    return Math.max(1, Math.round(ms / (1000*60*60*24)) + 1);
  }

  function haversineKm(a, b){
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI/180;
    const dLng = (b.lng - a.lng) * Math.PI/180;
    const lat1 = a.lat * Math.PI/180, lat2 = b.lat * Math.PI/180;
    const x = Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(lat1)*Math.cos(lat2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function walkingMinutes(km){
    return Math.round((km / 4.5) * 60); // 4.5 km/h
  }

  function pickPerDay(pois, numDays, pace){
    const perDay = pace === 'easy' ? 3 : pace === 'balanced' ? 4 : 5;
    const buckets = Array.from({length:numDays}, () => []);
    // Greedy: start near center each day, prefer unique categories, cap walking time
    const used = new Set();
    for (let d=0; d<numDays; d++){
      let dayList = [];
      let last = null;
      // try to vary categories daily
      const categoryCount = {};
      for (let i=0; i<pois.length && dayList.length < perDay; i++){
        const p = pois[i];
        if (used.has(p.id)) continue;
        if (last){
          const km = haversineKm(last, p);
          if (km > 3.5) continue; // keep hops walkable
        }
        if (p.category){
          const c = p.category;
          if ((categoryCount[c]||0) >= 2) continue;
          categoryCount[c] = (categoryCount[c]||0)+1;
        }
        dayList.push({
          id: crypto.randomUUID(),
          kind: 'poi',
          title: p.name,
          startTs: null, endTs: null,
          poiId: p.id,
          details: { category: p.category, rating: p.rating },
          lat: p.lat, lng: p.lng
        });
        used.add(p.id);
        last = p;
      }
      // If still short, allow farther picks
      for (let i=0; i<pois.length && dayList.length < perDay; i++){
        const p = pois[i];
        if (used.has(p.id)) continue;
        dayList.push({ id: crypto.randomUUID(), kind:'poi', title:p.name, startTs:null, endTs:null, poiId:p.id, details:{category:p.category, rating:p.rating}, lat:p.lat, lng:p.lng });
        used.add(p.id);
      }
      buckets[d] = dayList;
    }
    return buckets;
  }

  function filterByInterests(allPois, selected){
    return allPois.filter(p => {
      if (selected.includes('kids') && !p.kidFriendly) return false;
      if (selected.includes('culture') && p.category === 'culture') return true;
      if (selected.includes('food') && p.category === 'food') return true;
      if (selected.includes('nature') && p.category === 'nature') return true;
      if (selected.includes('shopping') && p.category === 'shopping') return true;
      // If specific categories chosen but this POI not matching any, exclude
      const onlyCats = selected.filter(x => x !== 'kids');
      if (onlyCats.length > 0) return false;
      return true;
    });
  }

  function renderTimeline(days, locale){
    timelineEl.innerHTML = '';
    days.forEach((items, idx) => {
      const dayDiv = document.createElement('div');
      dayDiv.className = 'day';
      const title = document.createElement('h3');
      title.textContent = `${(window.I18N?.t('day')) || (locale === 'he' ? 'יום' : 'Day')} ${idx+1}`;
      dayDiv.appendChild(title);
      items.forEach((it, i) => {
        const item = document.createElement('div');
        item.className = 'item';
        const left = document.createElement('div');
        left.className = 'left';
        const t = document.createElement('div');
        t.className = 'title'; t.textContent = it.title;
        const m = document.createElement('div');
        m.className = 'meta';
        const prev = i > 0 ? items[i-1] : null;
        if (prev){
          const km = haversineKm({lat:prev.lat,lng:prev.lng}, {lat:it.lat,lng:it.lng});
          m.textContent = `${walkingMinutes(km)} min walk · ${km.toFixed(1)} km`;
        } else {
          m.textContent = window.I18N?.t('start') || 'Start';
        }
        left.appendChild(t); left.appendChild(m);
        const right = document.createElement('div');
        right.className = 'right';
        const badge = document.createElement('div');
        badge.className = 'badge'; badge.textContent = it.details.category || 'poi';
        right.appendChild(badge);
        item.appendChild(left); item.appendChild(right);
        item.addEventListener('mouseenter', () => MapView.flyTo(it.lat, it.lng));
        dayDiv.appendChild(item);
      });
      timelineEl.appendChild(dayDiv);
    });
  }

  function setBookingLinks(cityName){
    const q = encodeURIComponent(cityName);
    bookFlights.href = `https://www.google.com/travel/flights?q=${q}`;
    bookFlights.textContent = window.I18N?.t('flights') || 'Flights';
    bookStays.href = `https://www.booking.com/searchresults.html?ss=${q}`;
    bookStays.textContent = window.I18N?.t('stays') || 'Stays';
    bookLinks.hidden = false;
  }

  function toIcs(plan){
    const lines = [
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Mindtrip Lite//MVP//EN'
    ];
    plan.days.forEach((items, di) => {
      items.forEach((it) => {
        const uid = it.id;
        const dt = new Date(plan.startDate);
        dt.setDate(dt.getDate()+di);
        const d = dt.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${d}`);
        lines.push(`DTSTART:${d}`);
        lines.push(`SUMMARY:${it.title}`);
        lines.push('END:VEVENT');
      });
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function download(filename, content, mime){
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 500);
  }

  async function generate(){
    const cityKey = citySelect.value;
    const city = DATA.cities[cityKey];
    const start = startInput.value || new Date().toISOString().slice(0,10);
    const end = endInput.value || start;
    const locale = document.documentElement.lang || 'en';
    const interestSelected = Array.from(interestsWrap.querySelectorAll('input:checked')).map(i => i.value);
    const pace = paceSelect.value;

    const numDays = daysBetween(start, end);
    let pois = filterByInterests(city.pois, interestSelected);

    if (pois.length === 0){
      // Show friendly empty state and fallback to popular picks
      const notice = document.createElement('div');
      notice.className = 'hint';
      notice.textContent = `${window.I18N?.t('noResults') || 'No results.'} ${(window.I18N?.t('showingPopular')||'Showing popular picks instead.')}`;
      timelineEl.innerHTML = '';
      timelineEl.appendChild(notice);
      pois = city.pois.slice().sort((a,b)=> (b.rating||0) - (a.rating||0));
    }

    const perDay = pickPerDay(pois, numDays, pace);

    currentPlan = { city: cityKey, startDate: start, endDate: end, days: perDay };

    MapView.initMap(city.center);
    MapView.setCenter(city.center);
    MapView.addMarkers(perDay.flat().map(x => ({ name:x.title, lat:x.lat, lng:x.lng })), (p)=>{});

    renderTimeline(perDay, locale);

    exportJsonBtn.disabled = false;
    exportIcsBtn.disabled = false;
    setBookingLinks(city.displayName);
  }

  function reset(){
    timelineEl.innerHTML = '';
    exportJsonBtn.disabled = true;
    exportIcsBtn.disabled = true;
    bookLinks.hidden = true;
  }

  function wire(){
    generateBtn.addEventListener('click', generate);
    resetBtn.addEventListener('click', reset);
    exportJsonBtn.addEventListener('click', () => {
      if (!currentPlan) return;
      download(`itinerary-${currentPlan.city}.json`, JSON.stringify(currentPlan, null, 2), 'application/json');
    });
    exportIcsBtn.addEventListener('click', () => {
      if (!currentPlan) return;
      download(`itinerary-${currentPlan.city}.ics`, toIcs(currentPlan), 'text/calendar');
    });
    // defaults
    const today = new Date();
    const next3 = new Date(); next3.setDate(today.getDate()+2);
    startInput.valueAsDate = today;
    endInput.valueAsDate = next3;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    const city = DATA.cities[citySelect.value];
    MapView.initMap(city.center);
    wire();
  });
})();