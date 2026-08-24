export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<File> {
  const source = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image()
      next.onload = () => resolve(next)
      next.onerror = reject
      next.src = source
    })
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file
  } finally {
    URL.revokeObjectURL(source)
  }
}
