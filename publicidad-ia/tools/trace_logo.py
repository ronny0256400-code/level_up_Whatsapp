import sys, cv2, numpy as np, potrace
src, out_svg, out_png = sys.argv[1:4]
im = cv2.imread(src, cv2.IMREAD_GRAYSCALE)
s = 1512/1500
x0,y0,x1,y1 = int(480*s),int(515*s),int(705*s),int(852*s)
c = im[y0:y1, x0:x1].astype(np.float32)
# corregir iluminación desigual (fondo negro con brillo variable)
bg = cv2.GaussianBlur(c, (0,0), 12)
c = np.clip(c - bg*0.85, 0, None)
c = cv2.normalize(c, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
K = 8
big = cv2.resize(c, None, fx=K, fy=K, interpolation=cv2.INTER_CUBIC)
big = cv2.GaussianBlur(big, (0,0), K*0.55)
_, bw = cv2.threshold(big, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, np.ones((K,K),np.uint8))
# quitar manchas pequeñas
n, lab, st, _ = cv2.connectedComponentsWithStats(bw)
keep = np.zeros_like(bw)
for i in range(1,n):
    if st[i, cv2.CC_STAT_AREA] > 40*K*K: keep[lab==i] = 255
# borde de la imagen a negro (evita un contorno de marco)
keep[:K*3,:]=0; keep[-K*3:,:]=0; keep[:,:K*3]=0; keep[:,-K*3:]=0
cv2.imwrite(out_png, keep)
H, W = keep.shape
bmp = potrace.Bitmap(keep > 0)
path = bmp.trace(turdsize=50, alphamax=1.1, opticurve=True, opttolerance=0.4)
d = []
def bbox(curve):
    xs=[curve.start_point.x]+[seg.end_point.x for seg in curve.segments]
    return min(xs), max(xs)
for curve in path:
    x0_,x1_=bbox(curve)
    if x1_-x0_ > 0.97*W: continue  # contorno del marco
    sp = curve.start_point; d.append(f"M{sp.x:.1f},{sp.y:.1f}")
    for seg in curve.segments:
        if seg.is_corner:
            d.append(f"L{seg.c.x:.1f},{seg.c.y:.1f}L{seg.end_point.x:.1f},{seg.end_point.y:.1f}")
        else:
            d.append(f"C{seg.c1.x:.1f},{seg.c1.y:.1f} {seg.c2.x:.1f},{seg.c2.y:.1f} {seg.end_point.x:.1f},{seg.end_point.y:.1f}")
    d.append("Z")
open(out_svg,"w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"><path fill="currentColor" fill-rule="evenodd" d="{"".join(d)}"/></svg>')
print("size", W, H, "curves", len(path))
