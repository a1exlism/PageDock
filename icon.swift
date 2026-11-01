import AppKit

guard CommandLine.arguments.count == 2 else { fatalError("Usage: icon.swift <output-directory>") }
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let iconset = root.appendingPathComponent("AppIcon.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func drawIcon(size: Int, destination: URL) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = CGFloat(size) / 1024
    let transform = AffineTransform(scale: scale)
    (transform as NSAffineTransform).concat()
    NSColor(red: 0.16, green: 0.24, blue: 0.37, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 52, y: 52, width: 920, height: 920), xRadius: 215, yRadius: 215).fill()
    let pane = NSBezierPath(roundedRect: NSRect(x: 230, y: 270, width: 564, height: 484), xRadius: 62, yRadius: 62)
    NSColor(red: 0.94, green: 0.96, blue: 0.99, alpha: 1).setStroke()
    pane.lineWidth = 30
    pane.stroke()
    let line = NSBezierPath()
    line.move(to: NSPoint(x: 235, y: 620))
    line.line(to: NSPoint(x: 790, y: 620))
    line.lineWidth = 25
    line.stroke()
    NSColor(red: 0.61, green: 0.76, blue: 0.95, alpha: 1).setFill()
    for x in [299, 365, 431] {
        NSBezierPath(ovalIn: NSRect(x: x, y: 675, width: 24, height: 24)).fill()
    }
    let arrow = NSBezierPath()
    arrow.move(to: NSPoint(x: 370, y: 449))
    arrow.line(to: NSPoint(x: 650, y: 449))
    arrow.move(to: NSPoint(x: 555, y: 545))
    arrow.line(to: NSPoint(x: 650, y: 449))
    arrow.line(to: NSPoint(x: 555, y: 353))
    arrow.lineWidth = 33
    arrow.lineCapStyle = .round
    arrow.lineJoinStyle = .round
    arrow.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: destination)
}

for size in [16, 32, 128, 256, 512] {
    try drawIcon(size: size, destination: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try drawIcon(size: size * 2, destination: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", root.appendingPathComponent("AppIcon.icns").path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { fatalError("iconutil failed") }
