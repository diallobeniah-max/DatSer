import React, { useState, useRef, useCallback } from 'react'
import { X, ZoomIn, ZoomOut, RotateCw, Check, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'

// Popular emojis for profile pictures
const PROFILE_EMOJIS = [
    '😀', '😎', '🤩', '🥳', '😇', '🤗', '🙂', '😊',
    '👋', '✨', '🌟', '⭐', '🔥', '💪', '🎯', '🚀',
    '💜', '💙', '💚', '💛', '🧡', '❤️', '🖤', '🤍',
    '👤', '👨', '👩', '🧑', '👦', '👧', '🦸', '🦹'
]

const ProfilePhotoEditor = ({ isOpen, onClose, user, onSuccess }) => {
    const [selectedImage, setSelectedImage] = useState(null)
    const [previewUrl, setPreviewUrl] = useState(null)
    const [zoom, setZoom] = useState(1)
    const [rotation, setRotation] = useState(0)
    const [isUploading, setIsUploading] = useState(false)
    const [selectedEmoji, setSelectedEmoji] = useState(null)
    const [activeTab, setActiveTab] = useState('upload') // 'upload' or 'emoji'
    const fileInputRef = useRef(null)
    const canvasRef = useRef(null)

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file')
            return
        }

        if (file.size > 3 * 1024 * 1024) {
            toast.error('Image must be less than 3MB')
            return
        }

        setSelectedImage(file)
        setSelectedEmoji(null)
        const url = URL.createObjectURL(file)
        setPreviewUrl(url)
        setZoom(1)
        setRotation(0)
    }

    const handleEmojiSelect = (emoji) => {
        setSelectedEmoji(emoji)
        setSelectedImage(null)
        setPreviewUrl(null)
    }

    const createCroppedImage = useCallback(async () => {
        // Use smaller size to avoid header too large errors
        const OUTPUT_SIZE = 96 // Small avatar size

        if (selectedEmoji) {
            // Create canvas with emoji
            const canvas = document.createElement('canvas')
            canvas.width = OUTPUT_SIZE
            canvas.height = OUTPUT_SIZE
            const ctx = canvas.getContext('2d')

            // Draw gradient background
            const gradient = ctx.createLinearGradient(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
            gradient.addColorStop(0, '#6366f1')
            gradient.addColorStop(1, '#8b5cf6')
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2)
            ctx.fill()

            // Draw emoji - scale font size proportionally
            ctx.font = `${OUTPUT_SIZE / 2}px Arial`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(selectedEmoji, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2 + 2)

            return new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/png', 0.8)
            })
        }

        if (!selectedImage || !previewUrl) return null

        return new Promise((resolve) => {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                const canvas = document.createElement('canvas')
                const size = 96 // Small output size to avoid header too large errors
                canvas.width = size
                canvas.height = size
                const ctx = canvas.getContext('2d')

                // Clear and prepare canvas
                ctx.clearRect(0, 0, size, size)

                // Create circular clipping path
                ctx.beginPath()
                ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
                ctx.closePath()
                ctx.clip()

                // Calculate scaling to fit image in circle
                const minDim = Math.min(img.width, img.height)
                const scale = (size / minDim) * zoom
                const dx = (size - img.width * scale) / 2
                const dy = (size - img.height * scale) / 2

                // Apply rotation
                ctx.save()
                ctx.translate(size / 2, size / 2)
                ctx.rotate((rotation * Math.PI) / 180)
                ctx.translate(-size / 2, -size / 2)

                // Draw image
                ctx.drawImage(img, dx, dy, img.width * scale, img.height * scale)
                ctx.restore()

                // Use higher compression (0.6) to keep size small
                canvas.toBlob(resolve, 'image/jpeg', 0.6)
            }
            img.src = previewUrl
        })
    }, [selectedImage, previewUrl, zoom, rotation, selectedEmoji])

    const handleSave = async () => {
        setIsUploading(true)
        try {
            const blob = await createCroppedImage()
            if (!blob) {
                toast.error('No image to save')
                setIsUploading(false)
                return
            }

            // Get current session
            const { data: { session }, error: sessionError } = await supabase.auth.getSession()

            if (sessionError || !session) {
                console.log('No valid session, saving to localStorage as fallback')
                // Convert to small base64 for localStorage
                const base64 = await new Promise((resolve) => {
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result)
                    reader.readAsDataURL(blob)
                })
                localStorage.setItem('user_avatar_url', base64)
                toast.success('Profile photo saved locally!')
                onSuccess?.()
                onClose()
                setTimeout(() => window.location.reload(), 500)
                return
            }

            const userId = session.user.id
            const fileExt = selectedEmoji ? 'png' : 'jpg'
            const fileName = `${userId}/avatar.${fileExt}`

            console.log('Uploading to storage:', fileName)

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, blob, {
                    upsert: true,
                    contentType: selectedEmoji ? 'image/png' : 'image/jpeg'
                })

            if (uploadError) {
                console.error('Storage upload error:', uploadError)
                // Fallback: Save small base64 to localStorage
                const base64 = await new Promise((resolve) => {
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result)
                    reader.readAsDataURL(blob)
                })
                localStorage.setItem('user_avatar_url', base64)
                toast.success('Profile photo saved locally!')
                onSuccess?.()
                onClose()
                setTimeout(() => window.location.reload(), 500)
                return
            }

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('avatars')
                .getPublicUrl(fileName)

            console.log('Got public URL:', publicUrl)

            // Add cache-busting timestamp to URL
            const avatarUrl = `${publicUrl}?t=${Date.now()}`

            // Save the URL (not base64) to user metadata
            const { error: updateError } = await supabase.auth.updateUser({
                data: { avatar_url: avatarUrl }
            })

            if (updateError) {
                console.error('Metadata update error:', updateError)
                // Still works - save URL to localStorage
                localStorage.setItem('user_avatar_url', avatarUrl)
            } else {
                // Clear any old localStorage avatar
                localStorage.removeItem('user_avatar_url')
            }

            toast.success('Profile photo updated!')
            onSuccess?.()
            onClose()
            setTimeout(() => window.location.reload(), 500)
        } catch (error) {
            console.error('Photo upload error:', error)
            toast.error('Failed to save photo. Please try again.')
        } finally {
            setIsUploading(false)
        }
    }

    const handleClose = () => {
        setSelectedImage(null)
        setPreviewUrl(null)
        setSelectedEmoji(null)
        setZoom(1)
        setRotation(0)
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-animate">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-scale-in">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Edit Profile Photo
                    </h3>
                    <button
                        onClick={handleClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 dark:border-gray-700">
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'upload'
                            ? 'text-orange-600 border-b-2 border-orange-600'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        📷 Upload Photo
                    </button>
                    <button
                        onClick={() => setActiveTab('emoji')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'emoji'
                            ? 'text-orange-600 border-b-2 border-orange-600'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        😀 Choose Emoji
                    </button>
                </div>

                {/* Content */}
                <div className="p-4">
                    {activeTab === 'upload' ? (
                        <>
                            {/* Preview Area */}
                            <div className="flex justify-center mb-4">
                                <div
                                    className="w-40 h-40 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center border-4 border-gray-200 dark:border-gray-600"
                                    style={{ position: 'relative' }}
                                >
                                    {previewUrl ? (
                                        <img
                                            src={previewUrl}
                                            alt="Preview"
                                            className="w-full h-full object-cover"
                                            style={{
                                                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                                                transition: 'transform 0.2s'
                                            }}
                                        />
                                    ) : (
                                        <div className="text-center text-gray-400">
                                            <ImageIcon className="w-12 h-12 mx-auto mb-2" />
                                            <p className="text-sm">No image</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Controls */}
                            {previewUrl && (
                                <div className="flex items-center justify-center gap-4 mb-4">
                                    <button
                                        onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                                        className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                                        title="Zoom Out"
                                    >
                                        <ZoomOut className="w-5 h-5" />
                                    </button>
                                    <span className="text-sm text-gray-600 dark:text-gray-300 min-w-[50px] text-center">
                                        {Math.round(zoom * 100)}%
                                    </span>
                                    <button
                                        onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                                        className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                                        title="Zoom In"
                                    >
                                        <ZoomIn className="w-5 h-5" />
                                    </button>
                                    <button
                                        onClick={() => setRotation((rotation + 90) % 360)}
                                        className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                                        title="Rotate"
                                    >
                                        <RotateCw className="w-5 h-5" />
                                    </button>
                                </div>
                            )}

                            {/* Upload Button */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                            >
                                <ImageIcon className="w-5 h-5" />
                                {previewUrl ? 'Choose Different Photo' : 'Select Photo'}
                            </button>
                        </>
                    ) : (
                        <>
                            {/* Emoji Preview */}
                            <div className="flex justify-center mb-4">
                                <div
                                    className="w-40 h-40 rounded-full overflow-hidden flex items-center justify-center border-4 border-gray-200 dark:border-gray-600"
                                    style={{
                                        background: selectedEmoji
                                            ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                                            : '#e5e7eb'
                                    }}
                                >
                                    {selectedEmoji ? (
                                        <span className="text-7xl">{selectedEmoji}</span>
                                    ) : (
                                        <span className="text-4xl">😀</span>
                                    )}
                                </div>
                            </div>

                            {/* Emoji Grid */}
                            <div className="grid grid-cols-8 gap-2 mb-4 max-h-48 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                                {PROFILE_EMOJIS.map((emoji) => (
                                    <button
                                        key={emoji}
                                        onClick={() => handleEmojiSelect(emoji)}
                                        className={`text-2xl p-2 rounded-lg transition-all ${selectedEmoji === emoji
                                            ? 'bg-orange-100 dark:bg-orange-900/50 scale-110 ring-2 ring-orange-500'
                                            : 'hover:bg-gray-200 dark:hover:bg-gray-600'
                                            }`}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                        onClick={handleClose}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isUploading || (!previewUrl && !selectedEmoji)}
                        className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isUploading ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Check className="w-4 h-4" />
                                Save Photo
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ProfilePhotoEditor
