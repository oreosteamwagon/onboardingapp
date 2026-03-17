'use client'

import { useState } from 'react'
import Link from 'next/link'

interface CourseAnswer {
  id: string
  text: string
  order: number
}

interface CourseQuestion {
  id: string
  text: string
  order: number
  answers: CourseAnswer[]
}

interface CourseData {
  id: string
  title: string
  description: string | null
  contentHtml: string
  passingScore: number
  questions: CourseQuestion[]
}

interface AttemptSummary {
  id: string
  score: number
  passed: boolean
  attemptNumber: number
  completedAt: string
}

interface CourseTakerProps {
  course: CourseData
  attempts: AttemptSummary[]
  taskId: string
}

export default function CourseTaker({ course, attempts: initialAttempts, taskId }: CourseTakerProps) {
  const [attempts, setAttempts] = useState(initialAttempts)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    attemptId: string
    score: number
    passed: boolean
    passingScore: number
    attemptNumber: number
  } | null>(null)

  const bestScore = attempts.length > 0 ? Math.max(...attempts.map((a) => a.score)) : null
  const latestPassedAttempt = attempts.filter((a) => a.passed).at(-1)

  function resetQuiz() {
    setSelectedAnswers({})
    setResult(null)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const answersPayload = course.questions.map((q) => ({
      questionId: q.id,
      answerId: selectedAnswers[q.id] ?? '',
    }))

    const unanswered = answersPayload.filter((a) => !a.answerId)
    if (unanswered.length > 0) {
      setError('Please answer all questions before submitting.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/courses/${course.id}/take`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, answers: answersPayload }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Submission failed')
        return
      }
      setResult(data)
      setAttempts((prev) => [
        ...prev,
        {
          id: data.attemptId,
          score: data.score,
          passed: data.passed,
          attemptNumber: data.attemptNumber,
          completedAt: new Date().toISOString(),
        },
      ])
    } catch {
      setError('Unexpected error submitting quiz.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">{course.title}</h1>
        {course.description && (
          <p className="text-sm text-gray-500">{course.description}</p>
        )}
      </div>

      {attempts.length > 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 rounded px-4 py-2 flex gap-4">
          <span>{attempts.length} attempt{attempts.length !== 1 ? 's' : ''}</span>
          {bestScore !== null && <span>Best score: {bestScore}%</span>}
          {latestPassedAttempt && (
            <Link href={`/certificate/${latestPassedAttempt.id}`} className="text-indigo-600 hover:underline">
              View Certificate
            </Link>
          )}
        </div>
      )}

      <div
        className="prose prose-sm max-w-none bg-white rounded-lg shadow px-6 py-5"
        dangerouslySetInnerHTML={{ __html: course.contentHtml }}
      />

      {result ? (
        <div className={`rounded-lg shadow px-6 py-5 ${result.passed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <h2 className={`text-lg font-semibold mb-1 ${result.passed ? 'text-green-800' : 'text-red-800'}`}>
            {result.passed ? 'Passed!' : 'Not Passed'}
          </h2>
          <p className="text-sm text-gray-700 mb-3">
            Score: <strong>{result.score}%</strong> (passing: {result.passingScore}%) &mdash; Attempt {result.attemptNumber}
          </p>
          {result.passed ? (
            <Link
              href={`/certificate/${result.attemptId}`}
              className="inline-block rounded-md bg-green-700 text-white px-4 py-2 text-sm font-medium hover:bg-green-800 transition-colors"
            >
              View Certificate
            </Link>
          ) : (
            <button
              onClick={resetQuiz}
              className="rounded-md bg-primary text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Try Again
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <h2 className="text-base font-semibold text-gray-800">Quiz</h2>

          {error && (
            <div role="alert" className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {course.questions.map((q, qi) => (
            <fieldset key={q.id} className="bg-white rounded-lg shadow px-6 py-4">
              <legend className="text-sm font-medium text-gray-900 mb-3">
                {qi + 1}. {q.text}
              </legend>
              <div className="space-y-2">
                {q.answers.map((a) => (
                  <label key={a.id} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name={`question-${q.id}`}
                      value={a.id}
                      checked={selectedAnswers[q.id] === a.id}
                      onChange={() =>
                        setSelectedAnswers((prev) => ({ ...prev, [q.id]: a.id }))
                      }
                      className="h-4 w-4 text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-gray-800">{a.text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary text-white px-6 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Answers'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
