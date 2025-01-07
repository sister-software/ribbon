/**
 * @copyright Sister Software
 * @license AGPL-3.0
 * @author Teffen Ellis, et al.
 */

import { TypedArray } from "./shared.js"

/**
 * Type-predicate to determine if a value is an array-like object.
 */
export function isArrayLike<T>(input: unknown): input is ArrayLike<T> {
	return Boolean(input && typeof input === "object" && "length" in input)
}

/**
 * A possible input for a delimiter:
 *
 * - A single character code.
 * - A string of characters.
 * - An array of character codes.
 * - A buffer.
 * - An iterable of character codes.
 */
export type CharacterSequenceInput = number | string | Uint8Array | Buffer | Iterable<number>

/**
 * Common delimiter values.
 */
export const Delimiters = {
	/**
	 * Null (␀)
	 */
	Null: 0,

	/**
	 * Newline (␊)
	 */
	LineFeed: 10,

	/**
	 * Carriage return (␍)
	 */
	CarriageReturn: 13,

	/**
	 * Comma (–)
	 */
	Comma: 44,

	/**
	 * Tab (␉)
	 */
	Tab: 9,

	/**
	 * Space (␠)
	 */
	Space: 32,

	/**
	 * One (1)
	 */
	One: 49,

	/**
	 * Zero (0)
	 */
	Zero: 48,

	/**
	 * Double quote (")
	 */
	DoubleQuote: 34,

	/**
	 * Record separator (␞)
	 */
	RecordSeparator: 30,
} as const satisfies Record<string, number>

export const VisibleDelimiterMap = new Map<number, string>([
	[Delimiters.LineFeed, "␤"],
	[Delimiters.CarriageReturn, "␍"],
	[Delimiters.Comma, "-"],
	[Delimiters.Tab, "␉"],
	[Delimiters.Space, "␠"],
	[Delimiters.DoubleQuote, '"'],
	[Delimiters.RecordSeparator, "␞"],
	[Delimiters.Null, "␀"],
])

export function debugAsVisibleCharacters(delimiter: Uint8Array): string {
	return Array.from(delimiter)
		.map((charCode) => {
			const visible = VisibleDelimiterMap.get(charCode)

			return visible ?? String.fromCharCode(charCode)
		})
		.join("")
}

export function normalizeCharacterInput(input: CharacterSequenceInput): Uint8Array {
	switch (typeof input) {
		case "number":
			if (!Number.isInteger(input)) {
				throw new TypeError(`Numeric delimiters must be integers. Received: ${input}`)
			}

			return Uint8Array.from([input])
		case "string":
			return new TextEncoder().encode(input)
		case "object":
			if (isArrayLike(input)) {
				return input
			}

			if (Symbol.iterator in input) {
				return Uint8Array.from(input)
			}

			throw new TypeError(`Invalid delimiter type. Received an object, but it is not an array or buffer.`)

		default:
			throw new TypeError(`Invalid delimiter type. Received: ${input}`)
	}
}

/**
 * An encoded sequence of characters, typically bytes representing a delimiter.
 *
 * Unlike a string, this class is optimized for searching and slicing.
 *
 * This also allows for multi-byte delimiters, such as CRLF or unicode characters.
 */
export class CharacterSequence extends Uint8Array {
	/**
	 * A jump table for the Boyer-Moore-Horspool search algorithm.
	 */
	#skipIndex: number[]

	/**
	 * Perform a Boyer-Moore-Horspool search for the pattern in the text.
	 *
	 * @param text The encoded text to search.
	 * @param start The byte index to start searching from.
	 *
	 * @returns The byte index of the pattern in the text, or -1 if not found.
	 */
	public search(text: Uint8Array, start: number = 0): number {
		const n = text.length
		const m = this.length

		let i = start

		while (i <= n - m) {
			let j = m - 1

			// Match pattern from right to left
			while (j >= 0 && this[j] === text[i + j]) {
				j--
			}

			// Pattern found
			if (j < 0) return i

			// Jump based on the last character in the window
			i += this.#skipIndex[text[i + m - 1]!]!
		}

		return -1
	}

	/**
	 * Create a new character sequence from a delimiter.
	 */
	constructor(input: CharacterSequenceInput = Delimiters.LineFeed) {
		const bytes = normalizeCharacterInput(input)

		super(bytes)

		this.#skipIndex = new Array(256).fill(this.length)

		// Build the jump table - simpler than full Boyer-Moore
		for (let i = 0; i < this.length - 1; i++) {
			this.#skipIndex[this[i]!] = this.length - 1 - i
		}
	}
}

const encoder = new TextEncoder()

/**
 * Given a delimited line, split it into fields using the specified separator.
 *
 * Unlike `String.prototype.split`, this function correctly handles fields that contain the
 * separator character within double quotes.
 *
 * @param source The line to split.
 * @param needle The character that separates fields.
 * @yields Each field in the line.
 */
export function* takeDelimited<T extends TypedArray | string>(
	source: T,
	needle: Uint8Array = new CharacterSequence(",")
) {
	const haystack = (typeof source === "string" ? encoder.encode(source) : source) as Exclude<T, string>

	const contentDelimiters: number[] = []
	let doubleQuoteCount = 0

	// First, we traverse the line to find the field delimiters...
	for (let byteIndex = 0; byteIndex < haystack.byteLength; byteIndex++) {
		const byte = haystack[byteIndex]

		if (byte === Delimiters.DoubleQuote) {
			doubleQuoteCount++
		}

		// TODO: handle escaped double quotes
		// TODO: handle delimiters with a length greater than 1
		if (byte === needle[0] && doubleQuoteCount % 2 === 0) {
			contentDelimiters.push(byteIndex)
		}
	}

	// Now, we slice the line into fields.
	let sliceStart = 0

	for (let delimiterIndex = 0; delimiterIndex < contentDelimiters.length; delimiterIndex++) {
		const sliceEnd = contentDelimiters[delimiterIndex]!

		yield haystack.subarray(sliceStart, sliceEnd)
		sliceStart = sliceEnd + 1
	}

	// Finally, our last slice is the remainder of the line.
	yield haystack.subarray(sliceStart)
}