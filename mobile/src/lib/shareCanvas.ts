const SHARE_LOGO_URL = '/assets/pictures/BTF_ARENA_logo.png'

let logoPromise: Promise<HTMLImageElement> | null = null

function loadShareLogo() {
  if (!logoPromise) {
    logoPromise = new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Logo BTF Arena indisponible'))
      image.src = SHARE_LOGO_URL
    })
  }
  return logoPromise
}

export async function drawShareLogo(ctx: CanvasRenderingContext2D) {
  const logo = await loadShareLogo()
  const height = 88
  const width = height * (logo.naturalWidth / logo.naturalHeight)
  ctx.drawImage(logo, 80, 84, width, height)
}

export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}
