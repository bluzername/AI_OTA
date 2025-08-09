(function(){
  let map;
  let markers = [];

  function initMap(center){
    if (map) return;
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://demotiles.maplibre.org/style.json',
      center: [center.lng, center.lat],
      zoom: 11
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
  }

  function clearMarkers(){
    markers.forEach(m => m.remove());
    markers = [];
  }

  function addMarkers(pois, onClick){
    clearMarkers();
    pois.forEach(p => {
      const el = document.createElement('div');
      el.className = 'marker';
      Object.assign(el.style, { width:'16px', height:'16px', background:'#5b8cff', borderRadius:'50%', border:'2px solid #cfe', boxShadow:'0 0 0 2px rgba(91,140,255,0.25)' });
      const m = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(p.name))
        .addTo(map);
      el.addEventListener('click', () => onClick?.(p));
      markers.push(m);
    });
  }

  function flyTo(lat, lng){
    if (!map) return;
    map.flyTo({ center:[lng,lat], zoom:13, essential:true });
  }

  function setCenter(center){
    if (!map) return;
    map.setCenter([center.lng, center.lat]);
    map.setZoom(11);
  }

  window.MapView = { initMap, addMarkers, flyTo, setCenter };
})();