    //#region 头像与身份
    /** 头像：emoji + 配色渐变底；已上传图片时改渲染图片。 */
    function Avatar(props) {
      var member = props.member;
      var accent = props.accent;
      var size = props.size || 40;
      var image = member.avatar && member.avatar.kind === "image" && member.avatar.imageId ? member.avatar.imageId : "";
      var base = {
        width: size, height: size,
        borderRadius: size >= 36 ? 12 : 9,
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background: "linear-gradient(145deg," + tint(accent, 0.95) + "," + tint(accent, 0.38) + ")",
        boxShadow: "inset 0 0 0 1px " + tint(accent, 0.5),
        overflow: "hidden"
      };
      if (image.length > 0) {
        return h("span", { className: "ats-avatar", style: base, title: member.name },
          h("img", {
            src: ROUTE_AVATAR + "?id=" + encodeURIComponent(image),
            alt: member.name,
            style: { width: "100%", height: "100%", objectFit: "cover", display: "block" }
          })
        );
      }
      return h("span", { className: "ats-avatar", style: base, title: member.name + " · " + (member.emoji || "🤖") }, member.emoji || "🤖");
    }

    /** 把文件裁成 160×160 webp（照 DS-Bot 的做法），尽量控制在 150 KB 内。 */
    function avatarDataUrl(file) {
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return Promise.reject(new Error("请选择 PNG / JPEG / WebP 图片"));
      if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error("图片需小于 25 MB"));
      return createImageBitmap(file).then(function (bitmap) {
        var side = 160;
        var canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        var context = canvas.getContext("2d");
        context.imageSmoothingQuality = "high";
        var crop = Math.min(bitmap.width, bitmap.height);
        context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side);
        if (bitmap.close) bitmap.close();
        var qualities = [0.9, 0.75, 0.6, 0.45];
        for (var i = 0; i < qualities.length; i += 1) {
          var url = canvas.toDataURL("image/webp", qualities[i]);
          if (url.indexOf("data:image/webp") === 0 && url.length < 150000) return url;
        }
        return canvas.toDataURL("image/png");
      });
    }
    //#endregion
