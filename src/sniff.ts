/**
 * Kludges for bugs and behavior differences that can't be feature
 * detected are enabled based on userAgent etc sniffing.
 */
module sniff {

  // BROWSER SNIFFING

  export var gecko = /gecko\/\d/i.test(navigator.userAgent);
  export var ie_upto10 = /MSIE \d/.test(navigator.userAgent);
  export var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent);
  export var ie = ie_upto10 || ie_11up;
  export var ie_version = ie && (ie_upto10 ? (<any>document).documentMode || 6 : ie_11up[1]);
  export var webkit = /WebKit\//.test(navigator.userAgent);
  export var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(navigator.userAgent);
  export var chrome = /Chrome\//.test(navigator.userAgent);
  export var presto = /Opera\//.test(navigator.userAgent);
  export var safari = /Apple Computer/.test(navigator.vendor);
  export var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(navigator.userAgent);
  export var phantom = /PhantomJS/.test(navigator.userAgent);

  export var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);

  /**
   * This is woefully incomplete. Suggestions for alternative methods welcome.
   */
  export var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(navigator.userAgent);
  export var mac = ios || /Mac/.test(navigator.platform);
  export var windows = /win/i.test(navigator.platform);

  export var presto_version: number = presto && <any>navigator.userAgent.match(/Version\/(\d*\.\d*)/);
  if (presto_version) presto_version = Number(presto_version[1]);
  if (presto_version && presto_version >= 15) { presto = false; webkit = true; }

  /**
   * Some browsers use the wrong event properties to signal cmd/ctrl on OS X
   */
  export var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
  export var captureRightClick = gecko || (ie && ie_version >= 9);

  // Optimize some code when these features are not used.
  export var sawReadOnlySpans = false;
  export var sawCollapsedSpans = false;

}