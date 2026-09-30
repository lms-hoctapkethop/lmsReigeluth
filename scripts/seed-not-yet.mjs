const which = process.argv[2] ?? 'seed'
console.error(`db:seed:${which} thuộc mốc M2. M0 chưa nạp dữ liệu.`)
process.exit(1)
