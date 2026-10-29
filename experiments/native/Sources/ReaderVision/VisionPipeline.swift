import Foundation
import Vision
import CoreImage
import ImageIO
#if SWIFT_PACKAGE
import ReaderCore
#endif

public struct RecognitionResult {
    public let image: CGImage
    public let dialogue: Dialogue?
    public let lines: [TextLine]
    public let screenFound: Bool
    public let panelIsBright: Bool
}

/// Owned by one serial processing queue; neither images nor recognized text are saved.
public final class VisionPipeline {
    private let context = CIContext(options: [.cacheIntermediates: false])
    public init() {}

    public func process(_ image: CGImage, detectScreen: Bool = true) throws -> RecognitionResult {
        var game = image
        var screenFound = false
        if detectScreen, let corrected = try rectifyScreen(image) {
            game = corrected; screenFound = true
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ja-JP", "en-US"]
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.012
        request.customWords = ["ゼニガメ", "フシギダネ", "メタモン", "モジャンボ", "ピカチュウ", "ポケモン"]
        // Vision uses a bottom-left origin. Search only the expected dialogue region.
        request.regionOfInterest = CGRect(x: 0.16, y: 0, width: 0.70, height: 0.30)
        try VNImageRequestHandler(cgImage: game).perform([request])
        let lines = (request.results ?? []).compactMap { observation -> TextLine? in
            guard let text = observation.topCandidates(1).first else { return nil }
            let b = observation.boundingBox
            return TextLine(text.string,
                            bounds: CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height),
                            confidence: text.confidence)
        }
        let bright = hasDialoguePanel(game)
        return RecognitionResult(image: game,
                                 dialogue: DialogueExtractor.extract(lines, panelIsBright: bright),
                                 lines: lines, screenFound: screenFound, panelIsBright: bright)
    }

    public func makeImage(_ buffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> CGImage? {
        let ci = CIImage(cvPixelBuffer: buffer).oriented(orientation)
        return context.createCGImage(ci, from: ci.extent)
    }

    private func rectifyScreen(_ image: CGImage) throws -> CGImage? {
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = 8
        request.minimumConfidence = 0.60
        request.minimumSize = 0.24
        request.minimumAspectRatio = 0.40
        request.maximumAspectRatio = 0.85
        request.quadratureTolerance = 28
        try VNImageRequestHandler(cgImage: image).perform([request])
        let w = CGFloat(image.width), h = CGFloat(image.height)
        let candidates = (request.results ?? []).filter {
            let b = $0.boundingBox
            let aspect = b.width * w / (b.height * h)
            return aspect > 1.3 && aspect < 2.25 && b.width * b.height > 0.18
        }
        let best = candidates.max { a, b in
            func score(_ r: VNRectangleObservation) -> CGFloat {
                let box = r.boundingBox
                let aspect = box.width * w / (box.height * h)
                return box.width * box.height - abs(aspect - 16.0 / 9.0) * 0.15
            }
            return score(a) < score(b)
        }
        guard let best else { return nil }
        // A full-screen screenshot needs no correction.
        if best.boundingBox.width > 0.98 && best.boundingBox.height > 0.98 { return image }
        func vector(_ p: CGPoint) -> CIVector { CIVector(x: p.x * w, y: p.y * h) }
        let corrected = CIImage(cgImage: image).applyingFilter("CIPerspectiveCorrection", parameters: [
            "inputTopLeft": vector(best.topLeft), "inputTopRight": vector(best.topRight),
            "inputBottomLeft": vector(best.bottomLeft), "inputBottomRight": vector(best.bottomRight)
        ])
        // Rectification can change the aspect ratio; restore the known 16:9 screen.
        let translated = corrected.transformed(by: .init(translationX: -corrected.extent.minX, y: -corrected.extent.minY))
        let targetWidth = min(1920.0, translated.extent.width)
        let resized = translated.transformed(by: .init(scaleX: targetWidth / translated.extent.width,
                                                       y: (targetWidth * 9 / 16) / translated.extent.height))
        return context.createCGImage(resized, from: resized.extent)
    }

    private func hasDialoguePanel(_ image: CGImage) -> Bool {
        // Sample the broad white balloon, away from its colored border and speaker tab.
        let rect = CGRect(x: CGFloat(image.width) * 0.235, y: CGFloat(image.height) * 0.835,
                          width: CGFloat(image.width) * 0.50, height: CGFloat(image.height) * 0.145)
        guard let crop = image.cropping(to: rect.integral) else { return false }
        let width = 64, height = 20
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let cg = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8,
                                 bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                 bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        cg.draw(crop, in: CGRect(x: 0, y: 0, width: width, height: height))
        var bright = 0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let r = Int(pixels[i]), g = Int(pixels[i + 1]), b = Int(pixels[i + 2])
            if min(r, g, b) > 155 && max(r, g, b) - min(r, g, b) < 65 { bright += 1 }
        }
        return Double(bright) / Double(width * height) > 0.53
    }
}
