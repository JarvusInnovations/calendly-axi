import { BOOK_FLAGS, parseFlags } from "../flags.js";
import { notImplemented } from "./not-implemented.js";

/** `book` — see `specs/commands/book.md`. Lands with `book`. */
export function bookCommand(args: string[]) {
  parseFlags("book", args, BOOK_FLAGS);
  return notImplemented("book", "book");
}
