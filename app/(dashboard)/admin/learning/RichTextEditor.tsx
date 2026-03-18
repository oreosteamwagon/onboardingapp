'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import 'prosemirror-view/style/prosemirror.css'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
    ],
    content: value,
    onUpdate: ({ editor: ed }: { editor: { getHTML: () => string } }) => {
      onChange(ed.getHTML())
    },
  })

  if (!editor) return null

  function addLink() {
    if (!editor) return
    const url = window.prompt('Enter URL (https://...):')
    if (!url) return
    if (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('mailto:')) {
      window.alert('URL must start with https://, http://, or mailto:')
      return
    }
    editor.chain().focus().setLink({ href: url }).run()
  }

  function addImage() {
    if (!editor) return
    const url = window.prompt('Enter image URL (https://...):')
    if (!url) return
    if (!url.startsWith('https://') && !url.startsWith('data:')) {
      window.alert('Image URL must start with https://')
      return
    }
    editor.chain().focus().setImage({ src: url }).run()
  }

  const btnClass = (active: boolean) =>
    `px-2 py-1 text-xs rounded border transition-colors ${
      active
        ? 'bg-gray-800 text-white border-gray-800'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
    }`

  return (
    <div className="border border-gray-300 rounded-md overflow-hidden">
      <div className="flex flex-wrap gap-1 p-2 bg-gray-50 border-b border-gray-200">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btnClass(editor.isActive('bold'))}
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btnClass(editor.isActive('italic'))}
        >
          I
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={btnClass(editor.isActive('heading', { level: 2 }))}
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={btnClass(editor.isActive('heading', { level: 3 }))}
        >
          H3
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btnClass(editor.isActive('bulletList'))}
        >
          List
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btnClass(editor.isActive('orderedList'))}
        >
          1.
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={btnClass(editor.isActive('blockquote'))}
        >
          &ldquo;&rdquo;
        </button>
        <button
          type="button"
          onClick={addLink}
          className={btnClass(editor.isActive('link'))}
        >
          Link
        </button>
        <button
          type="button"
          onClick={addImage}
          className={btnClass(false)}
        >
          Image
        </button>
      </div>
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none"
      />
    </div>
  )
}
