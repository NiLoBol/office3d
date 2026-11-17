/* office3d/v2/lib2/assemble.js — ประกอบทุกโมดูลเป็นฉากเดียว (ใช้ทั้ง index.html และหน้าดูภาพ)
   คืน { groups, colliders, lighting, shellTop, spaces, problems } */
(function () {
  var O = window.O3D2 = window.O3D2 || {};
  O.assemble = function (ctx, opts) {
    opts = opts || {};
    var THREE = ctx.THREE || window.THREE;
    var scene = ctx.scene;
    var plan = ctx.plan || window.OFFICE2;
    var groups = {}, colliders = [], problems = [], spaces = plan.rooms.concat([plan.corridor]);

    function add(name, res) {
      if (!res || !res.group) return null;
      groups[name] = res.group;
      if (scene) scene.add(res.group);
      if (res.colliders) for (var i = 0; i < res.colliders.length; i++) colliders.push(res.colliders[i]);
      return res;
    }
    function safe(name, fn) {
      try { return add(name, fn()); } catch (e) { problems.push(name + ': ' + (e && e.message)); return null; }
    }

    if (O.structure) safe('structure', function () { return O.structure.build(ctx); });
    var shellTop = [];
    if (groups.structure) groups.structure.traverse(function (o) { if (/ceilings|roof/.test(o.name)) shellTop.push(o); });
    if (O.doors) safe('doors', function () { return O.doors.build(ctx); });

    [[O.furnitureWork, 'work'], [O.furnitureMeeting, 'meeting'], [O.furnitureLounge, 'lounge']].forEach(function (pair) {
      var mod = pair[0];
      if (!mod || !mod.buildRoom) return;
      spaces.forEach(function (sp) {
        if ((mod.types || []).indexOf(sp.furn) < 0) return;
        try {
          var res = mod.buildRoom(sp, ctx);
          if (res && res.group) { if (scene) scene.add(res.group); groups[pair[1] + ':' + sp.id] = res.group; }
          if (res && res.colliders) for (var i = 0; i < res.colliders.length; i++) colliders.push(res.colliders[i]);
        } catch (e) { problems.push('furniture ' + sp.id + ': ' + (e && e.message)); }
      });
    });

    var L = null;
    if (O.lighting) L = safe('lighting', function () { return O.lighting.build(ctx); }) || null;

    return { groups: groups, colliders: colliders, lighting: L, shellTop: shellTop, spaces: spaces, problems: problems };
  };
})();
