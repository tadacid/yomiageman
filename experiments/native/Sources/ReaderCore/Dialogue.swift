import Foundation
import CoreGraphics

public struct TextLine {
    public let text: String
    /// Normalized coordinates, origin at the TOP left of the rectified game screen.
    public let bounds: CGRect
    public let confidence: Float

    public init(_ text: String, bounds: CGRect, confidence: Float = 1) {
        self.text = text; self.bounds = bounds; self.confidence = confidence
    }
}

public struct Dialogue: Equatable {
    public let speaker: String
    public let text: String
    public init(speaker: String, text: String) { self.speaker = speaker; self.text = text }
    public var key: String { TextNormalizer.key(speaker) + "|" + TextNormalizer.key(text) }
}

public enum TextNormalizer {
    public static func key(_ text: String) -> String {
        // Preserve punctuation, numbers and small kana: they can change the meaning.
        text.precomposedStringWithCompatibilityMapping
            .components(separatedBy: .whitespacesAndNewlines).joined()
    }
    public static func spoken(_ text: String) -> String {
        text.split(whereSeparator: { $0.isNewline }).map {
            $0.trimmingCharacters(in: .whitespaces)
        }.joined(separator: " ")
    }
}

/// The standard bottom dialogue balloon in Poco a Pokémon. This deliberately
/// excludes inventory screens, response choices, and floating overhead messages.
public enum DialogueExtractor {
    public static func extract(_ lines: [TextLine], panelIsBright: Bool) -> Dialogue? {
        guard panelIsBright else { return nil }
        let reliable = lines.filter { $0.confidence >= 0.25 && !$0.text.isEmpty }
        let names = reliable.filter {
            let b = $0.bounds
            let count = TextNormalizer.key($0.text).count
            return b.midX > 0.20 && b.midX < 0.61 && b.midY > 0.715 && b.midY < 0.813
                && b.height > 0.017 && count >= 2 && count <= 18
        }
        guard let name = names.max(by: { $0.bounds.width < $1.bounds.width }) else { return nil }
        let excludedNames: Set<String> = ["もどる", "えらぶ", "決定", "キャンセル", "はい", "いいえ"]
        guard !excludedNames.contains(TextNormalizer.key(name.text)) else { return nil }
        var body = reliable.filter {
            let b = $0.bounds
            return b.midX > 0.19 && b.midX < 0.82 && b.midY > 0.823 && b.midY < 0.988
                && b.minX > 0.17 && b.maxX < 0.85 && b.height >= 0.019
        }
        // Discard small furigana observations relative to the main text size.
        if let maxHeight = body.map(\.bounds.height).max() {
            body = body.filter { $0.bounds.height >= max(0.019, maxHeight * 0.60) }
        }
        body.sort {
            if abs($0.bounds.midY - $1.bounds.midY) < 0.018 { return $0.bounds.minX < $1.bounds.minX }
            return $0.bounds.midY < $1.bounds.midY
        }
        let text = body.map(\.text).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard TextNormalizer.key(text).count >= 2 else { return nil }
        return Dialogue(speaker: name.text, text: text)
    }
}

/// Use monotonic timestamps. A newly visible dialogue must stop changing before
/// emission. Temporary missed frames do not make an old line speak again.
public struct ReadingGate {
    public var settleTime: TimeInterval
    public var absenceResetTime: TimeInterval = 2.2
    public var maximumObservationGap: TimeInterval = 1.8
    private var candidate: Dialogue?
    private var candidateSince: TimeInterval = 0
    private var samples = 0
    private var lastObservation: TimeInterval?
    private var absentSince: TimeInterval?
    private var lastEmittedKey: String?

    public init(settleTime: TimeInterval = 1.25) { self.settleTime = settleTime }

    public mutating func ingest(_ dialogue: Dialogue?, at now: TimeInterval) -> Dialogue? {
        if let lastObservation, now - lastObservation > maximumObservationGap {
            candidate = nil; samples = 0
        }
        lastObservation = now
        guard let dialogue else {
            candidate = nil; samples = 0
            if absentSince == nil { absentSince = now }
            if now - (absentSince ?? now) >= absenceResetTime { lastEmittedKey = nil }
            return nil
        }
        if let absentSince, now - absentSince >= absenceResetTime { lastEmittedKey = nil }
        absentSince = nil
        if candidate?.key != dialogue.key {
            candidate = dialogue; candidateSince = now; samples = 1
            return nil
        }
        candidate = dialogue
        samples += 1
        guard samples >= 3, now - candidateSince >= settleTime,
              dialogue.key != lastEmittedKey else { return nil }
        lastEmittedKey = dialogue.key
        return dialogue
    }

    public mutating func markRead(_ dialogue: Dialogue) { lastEmittedKey = dialogue.key }
    public mutating func reset() { self = ReadingGate(settleTime: settleTime) }
    public mutating func pause() { candidate = nil; samples = 0; lastObservation = nil; absentSince = nil }
}
