const Logo = ({ className, size = 25 }: {
    className?: string,
    size?: number
}) => {
    return (
        <img
            src={chrome.runtime.getURL('side-panel/logo.jpg')} className={`${className} bg-white rounded-full`}
            style={{ width: size + 'px', height: size + 'px' }}
            alt="logo" />
    )
}

export default Logo;