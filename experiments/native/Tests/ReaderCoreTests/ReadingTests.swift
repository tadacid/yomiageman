import XCTest
@testable import ReaderCore

final class ReadingTests: XCTestCase {
    let hello = Dialogue(speaker: "ゼニガメ", text: "いっしょに あそぼう！")
    func testTypewriterWaitsForCompleteText() {
        var gate = ReadingGate(settleTime: 1)
        for (i, text) in ["いっ", "いっしょに", "いっしょに あそぼう！"].enumerated() {
            XCTAssertNil(gate.ingest(.init(speaker: "ゼニガメ", text: text), at: Double(i) * 0.5))
        }
        XCTAssertNil(gate.ingest(hello, at: 1.5))
        XCTAssertEqual(gate.ingest(hello, at: 2), hello)
        XCTAssertNil(gate.ingest(hello, at: 3))
    }
    func testSpacingChangesDoNotRepeat() {
        var g = ReadingGate(settleTime: 1)
        _ = g.ingest(hello, at: 0); _ = g.ingest(hello, at: 0.5)
        XCTAssertEqual(g.ingest(hello, at: 1), hello)
        let other = Dialogue(speaker: "ゼニガメ", text: "いっしょに　あそぼう！")
        for t in [1.5, 2.0, 2.5, 3.0] { XCTAssertNil(g.ingest(other, at: t)) }
    }
    func testShortBlankDoesNotRepeatButNewConversationCan() {
        var g = ReadingGate(settleTime: 1)
        for t in [0.0, 0.5, 1] { _ = g.ingest(hello, at: t) }
        _ = g.ingest(nil, at: 1.5)
        for t in [2.0, 2.5, 3] { XCTAssertNil(g.ingest(hello, at: t)) }
        for t in [3.5, 4, 5, 6] { _ = g.ingest(nil, at: t) }
        _ = g.ingest(hello, at: 6.5); _ = g.ingest(hello, at: 7)
        XCTAssertEqual(g.ingest(hello, at: 7.5), hello)
    }
    func testDifferentSpeakerIsNewDialogue() {
        var g = ReadingGate(settleTime: 1)
        for t in [0.0, 0.5, 1] { _ = g.ingest(hello, at: t) }
        let next = Dialogue(speaker: "ピカチュウ", text: hello.text)
        _ = g.ingest(next, at: 1.5); _ = g.ingest(next, at: 2)
        XCTAssertEqual(g.ingest(next, at: 2.5), next)
    }
    func testLongFrameGapMustRestabilize() {
        var g = ReadingGate(settleTime: 1)
        _ = g.ingest(hello, at: 0); _ = g.ingest(hello, at: 0.5)
        XCTAssertNil(g.ingest(hello, at: 10))
        XCTAssertNil(g.ingest(hello, at: 10.5))
        XCTAssertEqual(g.ingest(hello, at: 11), hello)
    }
    func testNumbersAndSmallKanaAreNotCollapsed() {
        XCTAssertNotEqual(TextNormalizer.key("10こ"), TextNormalizer.key("11こ"))
        XCTAssertNotEqual(TextNormalizer.key("きょう"), TextNormalizer.key("きよう"))
        XCTAssertEqual(TextNormalizer.key("Ａ １２"), TextNormalizer.key("A12"))
    }
    func testUnstableOCRNeverEmits() {
        var g = ReadingGate()
        for n in 0..<30 {
            let d = Dialogue(speaker: "ゼニガメ", text: n % 2 == 0 ? "こんにちは" : "こんには")
            XCTAssertNil(g.ingest(d, at: Double(n) * 0.45))
        }
    }
    func testPausePreservesReadHistory() {
        var g = ReadingGate(settleTime: 1)
        for t in [0.0, 0.5, 1] { _ = g.ingest(hello, at: t) }
        g.pause()
        for t in [5.0, 5.5, 6] { XCTAssertNil(g.ingest(hello, at: t)) }
    }
    private var lines: [TextLine] { [
        .init("ゼニガメ", bounds: .init(x: 0.32, y: 0.75, width: 0.09, height: 0.03)),
        .init("今日も あそぼう！", bounds: .init(x: 0.23, y: 0.845, width: 0.4, height: 0.034)),
        .init("いっしょに 行こうよ", bounds: .init(x: 0.23, y: 0.91, width: 0.4, height: 0.034))
    ] }
    func testDialogueOrderAndRubyExclusion() {
        var input = lines.reversed().map { $0 }
        input.append(.init("きょう", bounds: .init(x: 0.23, y: 0.827, width: 0.045, height: 0.011)))
        let d = DialogueExtractor.extract(input, panelIsBright: true)
        XCTAssertEqual(d?.speaker, "ゼニガメ")
        XCTAssertEqual(d?.text, "今日も あそぼう！\nいっしょに 行こうよ")
    }
    func testRequiresNameAndPanel() {
        XCTAssertNil(DialogueExtractor.extract(Array(lines.dropFirst()), panelIsBright: true))
        XCTAssertNil(DialogueExtractor.extract(lines, panelIsBright: false))
    }
    func testResponseChoiceOutsideBalloonIsExcluded() {
        var input = lines
        input.append(.init("いっしょに行こう", bounds: .init(x: 0.69, y: 0.62, width: 0.24, height: 0.04)))
        XCTAssertEqual(DialogueExtractor.extract(input, panelIsBright: true)?.text, "今日も あそぼう！\nいっしょに 行こうよ")
    }
}
