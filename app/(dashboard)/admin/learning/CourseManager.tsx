'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const RichTextEditor = dynamic(() => import('./RichTextEditor'), { ssr: false })

interface CourseAnswer {
  text: string
  isCorrect: boolean
  order: number
}

interface CourseQuestion {
  text: string
  order: number
  answers: CourseAnswer[]
}

interface CourseFormData {
  title: string
  description: string
  contentHtml: string
  passingScore: number
  questions: CourseQuestion[]
}

interface CourseSummary {
  id: string
  title: string
  description: string | null
  passingScore: number
  createdAt: string
  _count: { questions: number; linkedTasks: number; attempts: number }
}

interface CourseManagerProps {
  courses: CourseSummary[]
  viewerIsAdmin: boolean
}

const emptyAnswer = (): CourseAnswer => ({ text: '', isCorrect: false, order: 0 })
const emptyQuestion = (): CourseQuestion => ({
  text: '',
  order: 0,
  answers: [emptyAnswer(), emptyAnswer()],
})
const emptyForm = (): CourseFormData => ({
  title: '',
  description: '',
  contentHtml: '',
  passingScore: 80,
  questions: [emptyQuestion()],
})

export default function CourseManager({ courses: initial, viewerIsAdmin }: CourseManagerProps) {
  const router = useRouter()
  const [courses, setCourses] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CourseFormData>(emptyForm())
  const [loading, setLoading] = useState(false)

  function clearMessages() {
    setError(null)
    setSuccess(null)
  }

  function openCreate() {
    clearMessages()
    setEditingId(null)
    setForm(emptyForm())
    setShowCreate(true)
  }

  async function openEdit(courseId: string) {
    clearMessages()
    setShowCreate(false)
    setLoading(true)
    try {
      const res = await fetch(`/api/courses/${courseId}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to load course')
        return
      }
      setForm({
        title: data.title,
        description: data.description ?? '',
        contentHtml: data.contentHtml,
        passingScore: data.passingScore,
        questions: data.questions.map((q: Record<string, unknown>) => ({
          text: q.text as string,
          order: q.order as number,
          answers: (q.answers as Array<Record<string, unknown>>).map((a) => ({
            text: a.text as string,
            isCorrect: a.isCorrect as boolean,
            order: a.order as number,
          })),
        })),
      })
      setEditingId(courseId)
    } catch {
      setError('Unexpected error loading course.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    clearMessages()
    setLoading(true)
    try {
      const url = editingId ? `/api/courses/${editingId}` : '/api/courses'
      const method = editingId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          contentHtml: form.contentHtml,
          passingScore: form.passingScore,
          questions: form.questions.map((q, qi) => ({
            text: q.text,
            order: qi,
            answers: q.answers.map((a, ai) => ({
              text: a.text,
              isCorrect: a.isCorrect,
              order: ai,
            })),
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to save course')
        return
      }
      if (editingId) {
        setCourses((prev) =>
          prev.map((c) =>
            c.id === editingId
              ? { ...c, title: data.title, passingScore: data.passingScore }
              : c,
          ),
        )
        setSuccess('Course updated.')
      } else {
        setSuccess('Course created.')
      }
      setShowCreate(false)
      setEditingId(null)
      router.refresh()
    } catch {
      setError('Unexpected error saving course.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(courseId: string, title: string) {
    if (!viewerIsAdmin) return
    if (!window.confirm(`Delete course "${title}"? This cannot be undone.`)) return
    clearMessages()
    setLoading(true)
    try {
      const res = await fetch(`/api/courses/${courseId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to delete course')
        return
      }
      setCourses((prev) => prev.filter((c) => c.id !== courseId))
      setSuccess('Course deleted.')
    } catch {
      setError('Unexpected error deleting course.')
    } finally {
      setLoading(false)
    }
  }

  function addQuestion() {
    setForm((f) => ({ ...f, questions: [...f.questions, emptyQuestion()] }))
  }

  function removeQuestion(qi: number) {
    setForm((f) => ({ ...f, questions: f.questions.filter((_, i) => i !== qi) }))
  }

  function updateQuestion(qi: number, patch: Partial<CourseQuestion>) {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)),
    }))
  }

  function addAnswer(qi: number) {
    if (form.questions[qi].answers.length >= 4) return
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) =>
        i === qi ? { ...q, answers: [...q.answers, emptyAnswer()] } : q,
      ),
    }))
  }

  function removeAnswer(qi: number, ai: number) {
    if (form.questions[qi].answers.length <= 2) return
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) =>
        i === qi ? { ...q, answers: q.answers.filter((_, j) => j !== ai) } : q,
      ),
    }))
  }

  function updateAnswer(qi: number, ai: number, patch: Partial<CourseAnswer>) {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) =>
        i === qi
          ? { ...q, answers: q.answers.map((a, j) => (j === ai ? { ...a, ...patch } : a)) }
          : q,
      ),
    }))
  }

  function setCorrectAnswer(qi: number, ai: number) {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) =>
        i === qi
          ? { ...q, answers: q.answers.map((a, j) => ({ ...a, isCorrect: j === ai })) }
          : q,
      ),
    }))
  }

  const isFormOpen = showCreate || editingId !== null

  return (
    <div>
      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          onClick={isFormOpen ? () => { setShowCreate(false); setEditingId(null) } : openCreate}
          className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {isFormOpen ? 'Cancel' : 'New Course'}
        </button>
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow px-6 py-5 mb-6 space-y-6">
          <h2 className="text-base font-semibold text-gray-800">
            {editingId ? 'Edit Course' : 'New Course'}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={256}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                maxLength={2000}
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Passing Score (%) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                required
                min={1}
                max={100}
                value={form.passingScore}
                onChange={(e) =>
                  setForm((f) => ({ ...f, passingScore: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)) }))
                }
                className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Course Content <span className="text-red-500">*</span>
              </label>
              <RichTextEditor
                value={form.contentHtml}
                onChange={(html) => setForm((f) => ({ ...f, contentHtml: html }))}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Quiz Questions</h3>
              <button
                type="button"
                onClick={addQuestion}
                className="text-xs text-primary hover:underline"
              >
                + Add Question
              </button>
            </div>
            <div className="space-y-4">
              {form.questions.map((q, qi) => (
                <div key={qi} className="border border-gray-200 rounded-md px-4 py-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <label className="text-xs font-medium text-gray-600">Question {qi + 1}</label>
                    {form.questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeQuestion(qi)}
                        className="text-xs text-red-500 hover:text-red-700 shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={1000}
                    value={q.text}
                    onChange={(e) => updateQuestion(qi, { text: e.target.value })}
                    placeholder="Question text..."
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <div className="space-y-2">
                    {q.answers.map((a, ai) => (
                      <div key={ai} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${qi}`}
                          checked={a.isCorrect}
                          onChange={() => setCorrectAnswer(qi, ai)}
                          title="Mark as correct answer"
                        />
                        <input
                          type="text"
                          required
                          maxLength={500}
                          value={a.text}
                          onChange={(e) => updateAnswer(qi, ai, { text: e.target.value })}
                          placeholder={`Answer ${ai + 1}...`}
                          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                        />
                        {q.answers.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeAnswer(qi, ai)}
                            className="text-xs text-red-400 hover:text-red-600 shrink-0"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {q.answers.length < 4 && (
                    <button
                      type="button"
                      onClick={() => addAnswer(qi)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      + Add Answer
                    </button>
                  )}
                  <p className="text-xs text-gray-400">Select the radio button next to the correct answer.</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowCreate(false); setEditingId(null) }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Saving...' : editingId ? 'Save Changes' : 'Create Course'}
            </button>
          </div>
        </form>
      )}

      {courses.length === 0 ? (
        <div className="text-gray-500 text-sm">No courses defined yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="pb-2 pr-4">Title</th>
                <th className="pb-2 pr-4">Questions</th>
                <th className="pb-2 pr-4">Linked Tasks</th>
                <th className="pb-2 pr-4">Attempts</th>
                <th className="pb-2 pr-4">Pass %</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {courses.map((course) => (
                <tr key={course.id} className="hover:bg-gray-50">
                  <td className="py-3 pr-4 font-medium text-gray-900">{course.title}</td>
                  <td className="py-3 pr-4 text-gray-600">{course._count.questions}</td>
                  <td className="py-3 pr-4 text-gray-600">{course._count.linkedTasks}</td>
                  <td className="py-3 pr-4 text-gray-600">{course._count.attempts}</td>
                  <td className="py-3 pr-4 text-gray-600">{course.passingScore}%</td>
                  <td className="py-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => openEdit(course.id)}
                        disabled={loading}
                        className="text-primary hover:underline disabled:opacity-50"
                      >
                        Edit
                      </button>
                      {viewerIsAdmin && (
                        <button
                          onClick={() => handleDelete(course.id, course.title)}
                          disabled={loading}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
