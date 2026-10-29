import Foundation
import ImageIO
import ReaderVision

guard CommandLine.arguments.count > 1 else {
    print("Usage: swift run OCRProbe image [--screen] [--expect text] [--expect-none]")
    exit(2)
}
let path = CommandLine.arguments[1]
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    print("Could not open image"); exit(2)
}
do {
    let result = try VisionPipeline().process(image, detectScreen: !CommandLine.arguments.contains("--screen"))
    print("screen=\(result.screenFound) panel=\(result.panelIsBright)")
    for line in result.lines {
        print(String(format: "%.2f x=%.3f y=%.3f h=%.3f %@", line.confidence,
                     line.bounds.minX, line.bounds.minY, line.bounds.height, line.text))
    }
    print("DIALOGUE: \(result.dialogue?.speaker ?? "none") / \(result.dialogue?.text ?? "none")")
    if let index = CommandLine.arguments.firstIndex(of: "--expect"), index + 1 < CommandLine.arguments.count {
        guard result.dialogue?.text.contains(CommandLine.arguments[index + 1]) == true else { exit(1) }
    }
    if CommandLine.arguments.contains("--expect-none"), result.dialogue != nil { exit(1) }
} catch { print(error); exit(1) }
