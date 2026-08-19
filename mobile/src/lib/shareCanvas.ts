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

function octagonPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const cut = size * .3
  ctx.beginPath()
  ctx.moveTo(x + cut, y)
  ctx.lineTo(x + size - cut, y)
  ctx.lineTo(x + size, y + cut)
  ctx.lineTo(x + size, y + size - cut)
  ctx.lineTo(x + size - cut, y + size)
  ctx.lineTo(x + cut, y + size)
  ctx.lineTo(x, y + size - cut)
  ctx.lineTo(x, y + cut)
  ctx.closePath()
}

async function loadShareAvatar(url?: string | null) {
  if (!url) return null
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

export async function drawShareAvatar(
  ctx: CanvasRenderingContext2D,
  options: { url?: string | null; name: string; x: number; y: number; size: number },
) {
  const { url, name, x, y, size } = options
  const frame = ctx.createLinearGradient(x, y, x + size, y + size)
  frame.addColorStop(0, '#ff536b')
  frame.addColorStop(.48, '#5b1420')
  frame.addColorStop(1, '#ee243c')
  ctx.save()
  ctx.shadowColor = 'rgba(238,36,60,.42)'
  ctx.shadowBlur = 28
  octagonPath(ctx, x, y, size)
  ctx.fillStyle = frame
  ctx.fill()
  ctx.restore()

  const inset = Math.max(8, size * .045)
  const innerX = x + inset
  const innerY = y + inset
  const innerSize = size - inset * 2
  const avatar = await loadShareAvatar(url)
  ctx.save()
  octagonPath(ctx, innerX, innerY, innerSize)
  ctx.clip()
  if (avatar) {
    const scale = Math.max(innerSize / avatar.naturalWidth, innerSize / avatar.naturalHeight)
    const width = avatar.naturalWidth * scale
    const height = avatar.naturalHeight * scale
    ctx.drawImage(avatar, innerX + (innerSize - width) / 2, innerY + (innerSize - height) / 2, width, height)
  } else {
    const fallback = ctx.createLinearGradient(innerX, innerY, innerX + innerSize, innerY + innerSize)
    fallback.addColorStop(0, '#dc263e')
    fallback.addColorStop(1, '#711423')
    ctx.fillStyle = fallback
    ctx.fillRect(innerX, innerY, innerSize, innerSize)
    ctx.fillStyle = '#fff'
    ctx.font = `900 ${Math.round(innerSize * .32)}px Arial`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name.trim().slice(0, 2).toUpperCase(), innerX + innerSize / 2, innerY + innerSize / 2)
  }
  const gloss = ctx.createLinearGradient(innerX, innerY, innerX, innerY + innerSize)
  gloss.addColorStop(0, 'rgba(255,255,255,.22)')
  gloss.addColorStop(.48, 'rgba(255,255,255,0)')
  ctx.fillStyle = gloss
  ctx.fillRect(innerX, innerY, innerSize, innerSize)
  ctx.restore()
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
